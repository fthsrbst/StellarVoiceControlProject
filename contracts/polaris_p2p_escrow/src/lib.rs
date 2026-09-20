//! Polaris P2P escrow — the on-chain leg of the TRY <-> USDC peer-to-peer ramp.
//!
//! # Why this contract exists
//!
//! The anchor (SEP-6) is the institutional rail. This is the other one: a user
//! with USDC can sell it for lira to another user, with the crypto side held by
//! the chain instead of by trust. A **seller** locks a SEP-41 token (USDC, PGUSD
//! or the XLM SAC) here and quotes a fiat price; a **buyer** accepts; the buyer
//! sends TRY off-chain; the seller confirms on-chain and the tokens are released
//! to the buyer. Nothing about the fiat leg is visible to the contract — see
//! *Trust model* below.
//!
//! # Trust model and its hard limit
//!
//! There is **no arbiter**. The contract enforces only the token leg:
//!
//! | Caller | Function | Auth | Effect |
//! |---|---|---|---|
//! | Seller | [`PolarisP2pEscrow::create_offer`] | `seller.require_auth()` | Tokens move seller -> contract |
//! | Buyer | [`PolarisP2pEscrow::accept`] | `buyer.require_auth()` | Offer is reserved for the buyer |
//! | Seller | [`PolarisP2pEscrow::confirm_fiat`] | `seller.require_auth()` | Tokens move contract -> buyer |
//! | Seller | [`PolarisP2pEscrow::cancel`] / [`PolarisP2pEscrow::reclaim`] | `seller.require_auth()` | Tokens move contract -> seller |
//!
//! The seller decides whether the fiat arrived. If a buyer sends TRY and the
//! seller refuses to `confirm_fiat`, once `pay_deadline` passes the seller can
//! `reclaim` the tokens and keep both sides. That is a deliberate scope decision,
//! not an oversight: a trusted third party or an on-chain fiat oracle is out of
//! scope for the testnet MVP. The remedy is social/legal, exactly as with any
//! first-contact P2P trade, and the app should say so plainly.
//!
//! # Moving the funds
//!
//! The contract custodies the tokens between `create_offer` and the terminal
//! transition. It moves them with the SEP-41 `transfer` path: the seller's
//! deposit is a nested `transfer(seller -> contract)` authorised by the seller's
//! own signature on `create_offer` (the simulation records the sub-invocation);
//! payouts are `transfer(contract -> ...)`, which the host authorises because the
//! contract is the caller. There is no `approve`/`transfer_from` allowance to set
//! up, unlike `polaris_guard`, because the escrow never spends a third party's
//! tokens — it spends tokens it already holds.
//!
//! # Rounding, units, time
//!
//! `amount` is in raw token units (USDC on Stellar has 7 decimals, so 1 USDC is
//! `10_000_000`). `price_try_kurus` is the asking price in Turkish lira kuruş
//! (1 TRY = 100 kuruş); it is recorded for the order book and never enforced
//! on-chain, because the contract cannot observe the fiat payment.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token::TokenClient, Address,
    Env, Vec,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Shortest offer life: a 60 s window is the smallest that is still tradeable.
const MIN_TTL_SECS: u64 = 60;
/// Longest offer life: 7 days. A seller who wants longer can create again.
const MAX_TTL_SECS: u64 = 7 * 24 * 60 * 60;
/// Time a buyer has to settle the fiat leg once the offer is accepted.
const PAY_WINDOW_SECS: u64 = 1_800;
/// Hard ceiling on [`PolarisP2pEscrow::list_open`]'s scan window.
const MAX_PAGE: u32 = 20;

const DAY_IN_LEDGERS: u32 = 17_280;
/// Only extend a TTL once it drops below ~30 days...
const BUMP_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
/// ...and then push it back out to ~120 days.
const BUMP_TO: u32 = 120 * DAY_IN_LEDGERS;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Typed rejections. A missing signature never reaches this enum: the host
/// refuses the invocation before the body runs, so the app must still range-route
/// host errors separately.
///
/// # Why the codes start at 200
///
/// A Soroban contract error crosses the wire as a bare `u32`. The Stellar Asset
/// Contract uses 1-13 and `polaris_guard` uses 100-116, so the escrow takes its
/// own block, 200+, and the app can tell which contract raised an error from the
/// number alone. Discriminants are public ABI — never renumber them.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// No offer with that id.
    OfferNotFound = 200,
    /// `amount` is zero or negative.
    InvalidAmount = 201,
    /// `price_try_kurus` is zero or negative.
    InvalidPrice = 202,
    /// `ttl_secs` outside `[MIN_TTL_SECS, MAX_TTL_SECS]`.
    InvalidTtl = 203,
    /// The offer is not `Open` for an action that requires it.
    OfferNotOpen = 204,
    /// `accept` was called at or after `expires_at`.
    OfferExpired = 205,
    /// The buyer is the seller.
    SelfTrade = 206,
    /// `confirm_fiat` was called on an offer that is not `Accepted`.
    OfferNotAccepted = 207,
    /// The caller address is not the offer's seller.
    NotSeller = 208,
    /// `reclaim` before the offer expired / the pay deadline passed.
    ReclaimTooEarly = 209,
    /// `reclaim` on a settled, cancelled or already-expired offer.
    ReclaimNotAllowed = 210,
    /// Checked arithmetic refused (offer id or timestamp advance).
    Overflow = 211,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Lifecycle of one offer. Terminal states are `Settled`, `Cancelled` and
/// `Expired`; every other entry point rejects them.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum OfferState {
    Open,
    Accepted,
    Settled,
    Cancelled,
    Expired,
}

/// One P2P trade invitation. `buyer`, `accepted_at` and `pay_deadline` are only
/// meaningful once the state is `Accepted` or later.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Offer {
    pub id: u64,
    pub seller: Address,
    pub token: Address,
    pub amount: i128,
    /// Total asking price for the whole `amount`, in kuruş. Recorded for the
    /// order book; not enforced on-chain (the contract cannot see the fiat leg).
    pub price_try_kurus: i128,
    pub created_at: u64,
    pub expires_at: u64,
    pub buyer: Option<Address>,
    pub accepted_at: u64,
    pub pay_deadline: u64,
    pub state: OfferState,
}

/// Persistent storage schema. Multi-tenant by construction: no owner, no admin,
/// no shared mutable index — only the id counter is global.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Offer(u64),
    /// Monotonic id source, starts at 1.
    NextOfferId,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Every transition publishes exactly one event, so an indexer can rebuild the
/// order book without re-reading storage.
#[contractevent]
pub struct OfferCreated {
    #[topic]
    pub offer_id: u64,
    #[topic]
    pub seller: Address,
    pub token: Address,
    pub amount: i128,
    pub price_try_kurus: i128,
    pub expires_at: u64,
}

#[contractevent]
pub struct OfferAccepted {
    #[topic]
    pub offer_id: u64,
    #[topic]
    pub buyer: Address,
    pub pay_deadline: u64,
}

#[contractevent]
pub struct OfferSettled {
    #[topic]
    pub offer_id: u64,
    #[topic]
    pub buyer: Address,
    pub amount: i128,
}

#[contractevent]
pub struct OfferCancelled {
    #[topic]
    pub offer_id: u64,
    #[topic]
    pub seller: Address,
}

#[contractevent]
pub struct OfferReclaimed {
    #[topic]
    pub offer_id: u64,
    #[topic]
    pub seller: Address,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct PolarisP2pEscrow;

#[contractimpl]
impl PolarisP2pEscrow {
    /// Seller opens an offer and locks `amount` of `token` in the contract.
    ///
    /// `ttl_secs` bounds how long the offer stays acceptable; the seller can
    /// always `cancel` sooner. The deposit is the last step, after the offer is
    /// stored, so a reentrant or failing token rolls the whole call back.
    pub fn create_offer(
        env: Env,
        seller: Address,
        token: Address,
        amount: i128,
        price_try_kurus: i128,
        ttl_secs: u64,
    ) -> Result<u64, Error> {
        seller.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if price_try_kurus <= 0 {
            return Err(Error::InvalidPrice);
        }
        if !(MIN_TTL_SECS..=MAX_TTL_SECS).contains(&ttl_secs) {
            return Err(Error::InvalidTtl);
        }

        let now = env.ledger().timestamp();
        let expires_at = now.checked_add(ttl_secs).ok_or(Error::Overflow)?;

        let id = read_next_id(&env);
        let next = id.checked_add(1).ok_or(Error::Overflow)?;
        env.storage().persistent().set(&DataKey::NextOfferId, &next);
        bump(&env, &DataKey::NextOfferId);

        let offer = Offer {
            id,
            seller: seller.clone(),
            token: token.clone(),
            amount,
            price_try_kurus,
            created_at: now,
            expires_at,
            buyer: None,
            accepted_at: 0,
            pay_deadline: 0,
            state: OfferState::Open,
        };
        let key = DataKey::Offer(id);
        env.storage().persistent().set(&key, &offer);
        bump(&env, &key);

        // Effects are committed; now the interaction. The seller signed this
        // call, so the nested `transfer` is covered by that auth entry.
        let contract = env.current_contract_address();
        TokenClient::new(&env, &token).transfer(&seller, &contract, &amount);

        OfferCreated {
            offer_id: id,
            seller,
            token,
            amount,
            price_try_kurus,
            expires_at,
        }
        .publish(&env);
        Ok(id)
    }

    /// Buyer reserves an open, unexpired offer and starts the fiat clock.
    /// `pay_deadline` is the moment the seller may `reclaim` instead.
    pub fn accept(env: Env, buyer: Address, offer_id: u64) -> Result<(), Error> {
        buyer.require_auth();
        let key = DataKey::Offer(offer_id);
        let mut offer: Offer = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::OfferNotFound)?;
        if offer.state != OfferState::Open {
            return Err(Error::OfferNotOpen);
        }
        let now = env.ledger().timestamp();
        // Expiry is inclusive: at `expires_at` the offer is no longer live.
        if now >= offer.expires_at {
            return Err(Error::OfferExpired);
        }
        if buyer == offer.seller {
            return Err(Error::SelfTrade);
        }

        offer.buyer = Some(buyer.clone());
        offer.accepted_at = now;
        offer.pay_deadline = now.checked_add(PAY_WINDOW_SECS).ok_or(Error::Overflow)?;
        offer.state = OfferState::Accepted;
        env.storage().persistent().set(&key, &offer);
        bump(&env, &key);

        OfferAccepted {
            offer_id,
            buyer,
            pay_deadline: offer.pay_deadline,
        }
        .publish(&env);
        Ok(())
    }

    /// Seller confirms the fiat arrived and releases the tokens to the buyer.
    /// Allowed at any time while `Accepted`, including after `pay_deadline` —
    /// confirming is always in the buyer's favour, so blocking it would only
    /// hurt them.
    pub fn confirm_fiat(env: Env, seller: Address, offer_id: u64) -> Result<(), Error> {
        seller.require_auth();
        let key = DataKey::Offer(offer_id);
        let mut offer: Offer = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::OfferNotFound)?;
        if offer.seller != seller {
            return Err(Error::NotSeller);
        }
        if offer.state != OfferState::Accepted {
            return Err(Error::OfferNotAccepted);
        }
        // Invariant: `accept` always sets a buyer before moving to `Accepted`.
        let buyer = offer.buyer.clone().ok_or(Error::OfferNotAccepted)?;

        offer.state = OfferState::Settled;
        env.storage().persistent().set(&key, &offer);
        bump(&env, &key);

        let contract = env.current_contract_address();
        TokenClient::new(&env, &offer.token).transfer(&contract, &buyer, &offer.amount);

        OfferSettled {
            offer_id,
            buyer,
            amount: offer.amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Seller withdraws an offer nobody has accepted yet. Refunds in full.
    pub fn cancel(env: Env, seller: Address, offer_id: u64) -> Result<(), Error> {
        seller.require_auth();
        let key = DataKey::Offer(offer_id);
        let mut offer: Offer = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::OfferNotFound)?;
        if offer.seller != seller {
            return Err(Error::NotSeller);
        }
        if offer.state != OfferState::Open {
            return Err(Error::OfferNotOpen);
        }

        offer.state = OfferState::Cancelled;
        env.storage().persistent().set(&key, &offer);
        bump(&env, &key);

        let contract = env.current_contract_address();
        TokenClient::new(&env, &offer.token).transfer(&contract, &seller, &offer.amount);

        OfferCancelled { offer_id, seller }.publish(&env);
        Ok(())
    }

    /// Seller takes the tokens back after a failed trade:
    ///
    /// * `Open` and `now >= expires_at` — the offer timed out unsold.
    /// * `Accepted` and `now > pay_deadline` — the buyer never completed fiat.
    ///
    /// This is the path that makes "no arbiter" visible: a buyer who *did* pay
    /// fiat but is not confirmed loses the race against a dishonest seller. See
    /// the crate docs.
    pub fn reclaim(env: Env, seller: Address, offer_id: u64) -> Result<(), Error> {
        seller.require_auth();
        let key = DataKey::Offer(offer_id);
        let mut offer: Offer = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::OfferNotFound)?;
        if offer.seller != seller {
            return Err(Error::NotSeller);
        }

        let now = env.ledger().timestamp();
        let refundable = match offer.state {
            OfferState::Open => now >= offer.expires_at,
            OfferState::Accepted => now > offer.pay_deadline,
            _ => return Err(Error::ReclaimNotAllowed),
        };
        if !refundable {
            return Err(Error::ReclaimTooEarly);
        }

        offer.state = OfferState::Expired;
        env.storage().persistent().set(&key, &offer);
        bump(&env, &key);

        let contract = env.current_contract_address();
        TokenClient::new(&env, &offer.token).transfer(&contract, &seller, &offer.amount);

        OfferReclaimed { offer_id, seller }.publish(&env);
        Ok(())
    }

    // -- views --------------------------------------------------------------

    pub fn get_offer(env: Env, offer_id: u64) -> Option<Offer> {
        env.storage().persistent().get(&DataKey::Offer(offer_id))
    }

    /// The id the next `create_offer` will receive. Ids are `1..next_offer_id()`,
    /// so this is the upper bound of a `list_open` sweep.
    pub fn next_offer_id(env: Env) -> u64 {
        read_next_id(&env)
    }

    /// Paginated order book. Read-only.
    ///
    /// Scans the id window `[start, start + limit)` (limit clamped to
    /// [`MAX_PAGE`]) and returns every **actionable** offer in it: state `Open`
    /// *and* not yet expired. Ids for settled/cancelled/expired offers and ids
    /// that were never used are holes and are skipped, so a sweep is:
    ///
    /// ```text
    /// start = 1
    /// while start < next_offer_id() {
    ///     page = list_open(start, 20)
    ///     start += 20            // advance by the WINDOW, not by page.len()
    /// }
    /// ```
    pub fn list_open(env: Env, start: u64, limit: u32) -> Vec<Offer> {
        let mut out = Vec::new(&env);
        let next = read_next_id(&env);
        let window = if limit > MAX_PAGE { MAX_PAGE } else { limit };
        let start = if start < 1 { 1 } else { start };
        if window == 0 || start >= next {
            return out;
        }
        let end = core::cmp::min(start.saturating_add(window as u64), next);
        let now = env.ledger().timestamp();
        for id in start..end {
            if let Some(offer) = env
                .storage()
                .persistent()
                .get::<_, Offer>(&DataKey::Offer(id))
            {
                if offer.state == OfferState::Open && now < offer.expires_at {
                    out.push_back(offer);
                }
            }
        }
        out
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn bump(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, BUMP_THRESHOLD, BUMP_TO);
}

fn read_next_id(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::NextOfferId)
        .unwrap_or(1u64)
}

mod test;
