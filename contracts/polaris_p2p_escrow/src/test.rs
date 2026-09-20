//! Unit tests for the P2P escrow lifecycle.
//!
//! The fixture registers a real Stellar Asset Contract and drives the money
//! through it, so balances and `transfer` authorization are exercised for real
//! rather than mocked away.
#![cfg(test)]
extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Event as _, IntoVal, Vec,
};

use crate::{
    Error, Offer, OfferAccepted, OfferCancelled, OfferCreated, OfferReclaimed, OfferSettled,
    OfferState, PolarisP2pEscrow, PolarisP2pEscrowClient,
};

/// 1 USDC in raw units (7 decimals).
const USDC: i128 = 10_000_000;
/// TRY in kuruş: 1 TRY = 100 kuruş.
const TRY: i128 = 100;
const T0: u64 = 1_700_000_000;
const PAY_WINDOW: u64 = 1_800;

struct Fx<'a> {
    escrow: PolarisP2pEscrowClient<'a>,
    escrow_id: Address,
    token: TokenClient<'a>,
    token_id: Address,
    seller: Address,
    buyer: Address,
    carol: Address,
}

fn setup(env: &Env) -> Fx<'_> {
    env.ledger().set_timestamp(T0);
    env.ledger().set_sequence_number(1_000);

    let escrow_id = env.register(PolarisP2pEscrow, ());
    let escrow = PolarisP2pEscrowClient::new(env, &escrow_id);

    let issuer = Address::generate(env);
    let token_id = env.register_stellar_asset_contract_v2(issuer).address();
    let token = TokenClient::new(env, &token_id);

    let seller = Address::generate(env);
    StellarAssetClient::new(env, &token_id).mint(&seller, &(10_000 * USDC));

    Fx {
        escrow,
        escrow_id,
        token,
        token_id,
        seller,
        buyer: Address::generate(env),
        carol: Address::generate(env),
    }
}

/// Opens the standard offer: 100 USDC for 4,000 TRY, live for one hour.
fn open(fx: &Fx) -> u64 {
    fx.escrow.create_offer(
        &fx.seller,
        &fx.token_id,
        &(100 * USDC),
        &(4_000 * TRY),
        &3_600,
    )
}

/// A fresh asset the seller holds none of unless asked.
fn second_token(env: &Env) -> (TokenClient<'_>, Address) {
    let issuer = Address::generate(env);
    let id = env.register_stellar_asset_contract_v2(issuer).address();
    (TokenClient::new(env, &id), id)
}

/// The ids of a page, in order, for concise assertions.
fn ids(env: &Env, offers: &Vec<Offer>) -> Vec<u64> {
    let mut out = Vec::new(env);
    for o in offers.iter() {
        out.push_back(o.id);
    }
    out
}

// ---------------------------------------------------------------------------
// create_offer
// ---------------------------------------------------------------------------

#[test]
fn create_offer_deposits_and_records_the_offer() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);

    let id = open(&fx);
    assert_eq!(id, 1);
    assert_eq!(fx.escrow.next_offer_id(), 2);

    // The seller's tokens are in the contract now, not with the seller.
    assert_eq!(fx.token.balance(&fx.escrow_id), 100 * USDC);
    assert_eq!(fx.token.balance(&fx.seller), 9_900 * USDC);

    let o = fx.escrow.get_offer(&id).unwrap();
    assert_eq!(o.id, id);
    assert_eq!(o.seller, fx.seller);
    assert_eq!(o.token, fx.token_id);
    assert_eq!(o.amount, 100 * USDC);
    assert_eq!(o.price_try_kurus, 4_000 * TRY);
    assert_eq!(o.created_at, T0);
    assert_eq!(o.expires_at, T0 + 3_600);
    assert_eq!(o.buyer, None);
    assert_eq!(o.accepted_at, 0);
    assert_eq!(o.pay_deadline, 0);
    assert_eq!(o.state, OfferState::Open);
}

#[test]
fn create_offer_validates_amount_price_and_ttl() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);

    for bad in [0i128, -1i128] {
        assert_eq!(
            fx.escrow
                .try_create_offer(&fx.seller, &fx.token_id, &bad, &(4_000 * TRY), &3_600),
            Err(Ok(Error::InvalidAmount))
        );
    }
    for bad in [0i128, -1i128] {
        assert_eq!(
            fx.escrow
                .try_create_offer(&fx.seller, &fx.token_id, &(100 * USDC), &bad, &3_600),
            Err(Ok(Error::InvalidPrice))
        );
    }
    // TTL bounds are inclusive: 60 s and 7 days are accepted, their neighbours
    // are not.
    assert_eq!(
        fx.escrow
            .try_create_offer(&fx.seller, &fx.token_id, &(100 * USDC), &(4_000 * TRY), &59),
        Err(Ok(Error::InvalidTtl))
    );
    assert_eq!(
        fx.escrow.try_create_offer(
            &fx.seller,
            &fx.token_id,
            &(100 * USDC),
            &(4_000 * TRY),
            &(7 * 86_400 + 1)
        ),
        Err(Ok(Error::InvalidTtl))
    );

    // Nothing was created and no tokens moved.
    assert_eq!(fx.escrow.next_offer_id(), 1);
    assert_eq!(fx.token.balance(&fx.escrow_id), 0);
    assert_eq!(fx.token.balance(&fx.seller), 10_000 * USDC);

    let short = fx.escrow.create_offer(
        &fx.seller,
        &fx.token_id,
        &(100 * USDC),
        &(4_000 * TRY),
        &60,
    );
    let long = fx.escrow.create_offer(
        &fx.seller,
        &fx.token_id,
        &(100 * USDC),
        &(4_000 * TRY),
        &(7 * 86_400),
    );
    assert_eq!(fx.escrow.get_offer(&short).unwrap().expires_at, T0 + 60);
    assert_eq!(
        fx.escrow.get_offer(&long).unwrap().expires_at,
        T0 + 7 * 86_400
    );
}

#[test]
fn create_offer_requires_the_seller_signature_and_a_nested_transfer_auth() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);

    // With no auth at all the call is refused before the body runs.
    env.mock_auths(&[]);
    assert!(fx
        .escrow
        .try_create_offer(&fx.seller, &fx.token_id, &(100 * USDC), &(4_000 * TRY), &3_600)
        .is_err());

    // A different signer cannot deposit as the seller.
    let attacker = Address::generate(&env);
    let attacker_auth = [MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &fx.escrow_id,
            fn_name: "create_offer",
            args: (
                fx.seller.clone(),
                fx.token_id.clone(),
                100 * USDC,
                4_000 * TRY,
                3_600u64,
            )
                .into_val(&env),
            sub_invokes: &[],
        },
    }];
    env.mock_auths(&attacker_auth);
    assert!(fx
        .escrow
        .try_create_offer(&fx.seller, &fx.token_id, &(100 * USDC), &(4_000 * TRY), &3_600)
        .is_err());

    // The real seller's single signature covers both the escrow call and the
    // nested token transfer it triggers (the deposit needs that sub-invocation).
    env.mock_all_auths();
    fx.escrow
        .create_offer(&fx.seller, &fx.token_id, &(100 * USDC), &(4_000 * TRY), &3_600);
    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths.first().unwrap().0, fx.seller);
    assert_eq!(
        auths.first().unwrap().1.sub_invocations.len(),
        1,
        "the deposit must record the token transfer as a sub-invocation"
    );
    assert_eq!(fx.token.balance(&fx.escrow_id), 100 * USDC);
}

// ---------------------------------------------------------------------------
// accept
// ---------------------------------------------------------------------------

#[test]
fn accept_locks_the_offer_and_starts_the_pay_window() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);
    let id = open(&fx);

    fx.escrow.accept(&fx.buyer, &id);

    let o = fx.escrow.get_offer(&id).unwrap();
    assert_eq!(o.state, OfferState::Accepted);
    assert_eq!(o.buyer, Some(fx.buyer.clone()));
    assert_eq!(o.accepted_at, T0);
    assert_eq!(o.pay_deadline, T0 + PAY_WINDOW);
    // Custody is unchanged; only the intended recipient is recorded.
    assert_eq!(fx.token.balance(&fx.escrow_id), 100 * USDC);
    assert_eq!(fx.token.balance(&fx.buyer), 0);
}

#[test]
fn accept_rejects_wrong_state_self_trade_and_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);

    // Unknown id.
    assert_eq!(
        fx.escrow.try_accept(&fx.buyer, &999),
        Err(Ok(Error::OfferNotFound))
    );

    // Seller cannot buy their own offer.
    let self_id = open(&fx);
    assert_eq!(
        fx.escrow.try_accept(&fx.seller, &self_id),
        Err(Ok(Error::SelfTrade))
    );

    // Double accept is refused.
    let id = open(&fx);
    fx.escrow.accept(&fx.buyer, &id);
    assert_eq!(
        fx.escrow.try_accept(&fx.carol, &id),
        Err(Ok(Error::OfferNotOpen))
    );

    // Expiry is inclusive: one second before is fine, at `expires_at` it is not.
    let exp_id = fx.escrow.create_offer(
        &fx.seller,
        &fx.token_id,
        &(100 * USDC),
        &(4_000 * TRY),
        &60,
    );
    env.ledger().set_timestamp(T0 + 60);
    assert_eq!(
        fx.escrow.try_accept(&fx.buyer, &exp_id),
        Err(Ok(Error::OfferExpired))
    );
    env.ledger().set_timestamp(T0 + 59);
    fx.escrow.accept(&fx.buyer, &exp_id);

    // Cancelled offers are closed.
    let cancelled = open(&fx);
    fx.escrow.cancel(&fx.seller, &cancelled);
    assert_eq!(
        fx.escrow.try_accept(&fx.buyer, &cancelled),
        Err(Ok(Error::OfferNotOpen))
    );
}

#[test]
fn accept_requires_the_buyer_signature() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);
    let id = open(&fx);

    env.mock_auths(&[]);
    assert!(fx.escrow.try_accept(&fx.buyer, &id).is_err());
    assert_eq!(
        fx.escrow.get_offer(&id).unwrap().state,
        OfferState::Open
    );
}

// ---------------------------------------------------------------------------
// confirm_fiat
// ---------------------------------------------------------------------------

#[test]
fn confirm_releases_the_tokens_to_the_buyer() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);
    let id = open(&fx);
    fx.escrow.accept(&fx.buyer, &id);

    // Seller confirming after the deadline still favours the buyer, so it works.
    env.ledger().set_timestamp(T0 + PAY_WINDOW + 100);
    fx.escrow.confirm_fiat(&fx.seller, &id);

    let o = fx.escrow.get_offer(&id).unwrap();
    assert_eq!(o.state, OfferState::Settled);
    assert_eq!(fx.token.balance(&fx.buyer), 100 * USDC);
    assert_eq!(fx.token.balance(&fx.escrow_id), 0);
    assert_eq!(fx.token.balance(&fx.seller), 9_900 * USDC);

    // Double settle is refused and moves nothing.
    assert_eq!(
        fx.escrow.try_confirm_fiat(&fx.seller, &id),
        Err(Ok(Error::OfferNotAccepted))
    );
    assert_eq!(fx.token.balance(&fx.buyer), 100 * USDC);
}

#[test]
fn confirm_rejections() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);

    assert_eq!(
        fx.escrow.try_confirm_fiat(&fx.seller, &999),
        Err(Ok(Error::OfferNotFound))
    );

    // Not the seller.
    let id = open(&fx);
    fx.escrow.accept(&fx.buyer, &id);
    assert_eq!(
        fx.escrow.try_confirm_fiat(&fx.carol, &id),
        Err(Ok(Error::NotSeller))
    );

    // Not yet accepted.
    let open_id = open(&fx);
    assert_eq!(
        fx.escrow.try_confirm_fiat(&fx.seller, &open_id),
        Err(Ok(Error::OfferNotAccepted))
    );

    // Cancelled.
    let cancelled = open(&fx);
    fx.escrow.cancel(&fx.seller, &cancelled);
    assert_eq!(
        fx.escrow.try_confirm_fiat(&fx.seller, &cancelled),
        Err(Ok(Error::OfferNotAccepted))
    );
}

#[test]
fn confirm_requires_the_seller_signature() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);
    let id = open(&fx);
    fx.escrow.accept(&fx.buyer, &id);

    env.mock_auths(&[]);
    assert!(fx.escrow.try_confirm_fiat(&fx.seller, &id).is_err());
    assert_eq!(fx.token.balance(&fx.buyer), 0);
}

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

#[test]
fn cancel_refunds_the_seller_while_open() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);
    let id = open(&fx);

    fx.escrow.cancel(&fx.seller, &id);

    assert_eq!(fx.escrow.get_offer(&id).unwrap().state, OfferState::Cancelled);
    assert_eq!(fx.token.balance(&fx.seller), 10_000 * USDC);
    assert_eq!(fx.token.balance(&fx.escrow_id), 0);
}

#[test]
fn cancel_rejections() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);

    assert_eq!(
        fx.escrow.try_cancel(&fx.seller, &999),
        Err(Ok(Error::OfferNotFound))
    );

    // A stranger passing their own address is not the seller.
    let id = open(&fx);
    assert_eq!(
        fx.escrow.try_cancel(&fx.carol, &id),
        Err(Ok(Error::NotSeller))
    );

    // Once accepted it can no longer be cancelled.
    fx.escrow.accept(&fx.buyer, &id);
    assert_eq!(
        fx.escrow.try_cancel(&fx.seller, &id),
        Err(Ok(Error::OfferNotOpen))
    );

    // Already cancelled.
    let cancelled = open(&fx);
    fx.escrow.cancel(&fx.seller, &cancelled);
    assert_eq!(
        fx.escrow.try_cancel(&fx.seller, &cancelled),
        Err(Ok(Error::OfferNotOpen))
    );

    // And it needs the seller's signature.
    let auth_id = open(&fx);
    env.mock_auths(&[]);
    assert!(fx.escrow.try_cancel(&fx.seller, &auth_id).is_err());
}

// ---------------------------------------------------------------------------
// reclaim
// ---------------------------------------------------------------------------

#[test]
fn reclaim_refunds_an_expired_open_offer_only_after_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);
    let id = fx.escrow.create_offer(
        &fx.seller,
        &fx.token_id,
        &(100 * USDC),
        &(4_000 * TRY),
        &60,
    );

    // One second before expiry: too early.
    env.ledger().set_timestamp(T0 + 59);
    assert_eq!(
        fx.escrow.try_reclaim(&fx.seller, &id),
        Err(Ok(Error::ReclaimTooEarly))
    );

    env.ledger().set_timestamp(T0 + 60);
    fx.escrow.reclaim(&fx.seller, &id);

    assert_eq!(fx.escrow.get_offer(&id).unwrap().state, OfferState::Expired);
    assert_eq!(fx.token.balance(&fx.seller), 10_000 * USDC);
    assert_eq!(fx.token.balance(&fx.escrow_id), 0);
}

#[test]
fn reclaim_refunds_an_unpaid_accepted_offer_only_after_the_deadline() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);
    let id = open(&fx);
    fx.escrow.accept(&fx.buyer, &id);

    // The deadline comparison is strict: at `pay_deadline` it is still too early.
    env.ledger().set_timestamp(T0 + PAY_WINDOW);
    assert_eq!(
        fx.escrow.try_reclaim(&fx.seller, &id),
        Err(Ok(Error::ReclaimTooEarly))
    );

    env.ledger().set_timestamp(T0 + PAY_WINDOW + 1);
    fx.escrow.reclaim(&fx.seller, &id);

    assert_eq!(fx.escrow.get_offer(&id).unwrap().state, OfferState::Expired);
    assert_eq!(fx.token.balance(&fx.seller), 10_000 * USDC);
    assert_eq!(fx.token.balance(&fx.buyer), 0);
}

#[test]
fn reclaim_rejects_terminal_states_and_requires_the_seller() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);

    assert_eq!(
        fx.escrow.try_reclaim(&fx.seller, &999),
        Err(Ok(Error::OfferNotFound))
    );

    let settled = open(&fx);
    fx.escrow.accept(&fx.buyer, &settled);
    fx.escrow.confirm_fiat(&fx.seller, &settled);
    assert_eq!(
        fx.escrow.try_reclaim(&fx.seller, &settled),
        Err(Ok(Error::ReclaimNotAllowed))
    );

    let cancelled = open(&fx);
    fx.escrow.cancel(&fx.seller, &cancelled);
    assert_eq!(
        fx.escrow.try_reclaim(&fx.seller, &cancelled),
        Err(Ok(Error::ReclaimNotAllowed))
    );

    let ancient = fx.escrow.create_offer(
        &fx.seller,
        &fx.token_id,
        &(100 * USDC),
        &(4_000 * TRY),
        &60,
    );
    // A stranger can't reclaim it, even once it is long expired.
    env.ledger().set_timestamp(T0 + 10_000);
    assert_eq!(
        fx.escrow.try_reclaim(&fx.carol, &ancient),
        Err(Ok(Error::NotSeller))
    );
    fx.escrow.reclaim(&fx.seller, &ancient);
    // A second reclaim on the now-expired offer is refused.
    assert_eq!(
        fx.escrow.try_reclaim(&fx.seller, &ancient),
        Err(Ok(Error::ReclaimNotAllowed))
    );
}

// ---------------------------------------------------------------------------
// get_offer / next_offer_id / list_open
// ---------------------------------------------------------------------------

#[test]
fn unknown_offer_is_reported() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);
    assert_eq!(fx.escrow.get_offer(&999), None);
    assert_eq!(fx.escrow.next_offer_id(), 1);
}

#[test]
fn list_open_paginates_and_bounds_its_scan() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);

    // Empty book.
    assert_eq!(fx.escrow.list_open(&1, &20), Vec::new(&env));

    for _ in 0..5 {
        open(&fx);
    }
    assert_eq!(fx.escrow.next_offer_id(), 6);
    assert_eq!(fx.escrow.list_open(&1, &20).len(), 5);

    // The window is `[start, start + limit)`, so paging advances by `limit`.
    let page1 = fx.escrow.list_open(&1, &2);
    assert_eq!(
        ids(&env, &page1),
        Vec::from_array(&env, [1u64, 2])
    );
    let page2 = fx.escrow.list_open(&3, &2);
    assert_eq!(
        ids(&env, &page2),
        Vec::from_array(&env, [3u64, 4])
    );
    let page3 = fx.escrow.list_open(&5, &2);
    assert_eq!(
        ids(&env, &page3),
        Vec::from_array(&env, [5u64])
    );
    assert_eq!(fx.escrow.list_open(&6, &2), Vec::new(&env));

    // A zero limit scans nothing; an oversized one is clamped, not rejected.
    assert_eq!(fx.escrow.list_open(&1, &0), Vec::new(&env));
    assert_eq!(fx.escrow.list_open(&1, &1_000).len(), 5);
}

#[test]
fn list_open_skips_holes_non_open_and_expired_offers() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);

    let accepted = open(&fx);
    let cancelled = open(&fx);
    let expired = fx.escrow.create_offer(
        &fx.seller,
        &fx.token_id,
        &(100 * USDC),
        &(4_000 * TRY),
        &60,
    );
    let live = open(&fx);

    fx.escrow.accept(&fx.buyer, &accepted);
    fx.escrow.cancel(&fx.seller, &cancelled);
    env.ledger().set_timestamp(T0 + 61);

    let listed = fx.escrow.list_open(&1, &20);
    assert_eq!(
        ids(&env, &listed),
        Vec::from_array(&env, [live]),
        "only the live open offer survives the scan (expired id {expired})"
    );
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[test]
fn error_codes_are_stable_and_outside_the_token_and_guard_ranges() {
    // These discriminants are public ABI: adding a variant must force a
    // deliberate edit here. The escrow owns 200+.
    let all = [
        Error::OfferNotFound,
        Error::InvalidAmount,
        Error::InvalidPrice,
        Error::InvalidTtl,
        Error::OfferNotOpen,
        Error::OfferExpired,
        Error::SelfTrade,
        Error::OfferNotAccepted,
        Error::NotSeller,
        Error::ReclaimTooEarly,
        Error::ReclaimNotAllowed,
        Error::Overflow,
    ];
    assert_eq!(all.len(), 12, "a variant was added without updating this test");
    for e in all {
        assert!((e as u32) >= 200, "{e:?} overlaps the guard's 100+ block");
    }
    assert_eq!(Error::OfferNotFound as u32, 200);
    assert_eq!(Error::Overflow as u32, 211);
}

// ---------------------------------------------------------------------------
// Events and multi-tenancy
// ---------------------------------------------------------------------------

/// Events published by the escrow itself, with the token's events filtered out.
fn escrow_events(env: &Env, id: &Address) -> std::vec::Vec<soroban_sdk::xdr::ContractEvent> {
    env.events()
        .all()
        .filter_by_contract(id)
        .events()
        .to_vec()
}

#[test]
fn every_transition_emits_one_event() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);

    let id = open(&fx);
    assert_eq!(
        escrow_events(&env, &fx.escrow_id),
        std::vec![OfferCreated {
            offer_id: id,
            seller: fx.seller.clone(),
            token: fx.token_id.clone(),
            amount: 100 * USDC,
            price_try_kurus: 4_000 * TRY,
            expires_at: T0 + 3_600,
        }
        .to_xdr(&env, &fx.escrow_id)]
    );

    fx.escrow.accept(&fx.buyer, &id);
    assert_eq!(
        escrow_events(&env, &fx.escrow_id),
        std::vec![OfferAccepted {
            offer_id: id,
            buyer: fx.buyer.clone(),
            pay_deadline: T0 + PAY_WINDOW,
        }
        .to_xdr(&env, &fx.escrow_id)]
    );

    fx.escrow.confirm_fiat(&fx.seller, &id);
    assert_eq!(
        escrow_events(&env, &fx.escrow_id),
        std::vec![OfferSettled {
            offer_id: id,
            buyer: fx.buyer.clone(),
            amount: 100 * USDC,
        }
        .to_xdr(&env, &fx.escrow_id)]
    );

    // Cancellation and reclaim each publish their own event.
    let cancelled = open(&fx);
    fx.escrow.cancel(&fx.seller, &cancelled);
    assert_eq!(
        escrow_events(&env, &fx.escrow_id),
        std::vec![OfferCancelled {
            offer_id: cancelled,
            seller: fx.seller.clone(),
        }
        .to_xdr(&env, &fx.escrow_id)]
    );

    let expired = fx.escrow.create_offer(
        &fx.seller,
        &fx.token_id,
        &(100 * USDC),
        &(4_000 * TRY),
        &60,
    );
    env.ledger().set_timestamp(T0 + 10_000);
    fx.escrow.reclaim(&fx.seller, &expired);
    assert_eq!(
        escrow_events(&env, &fx.escrow_id),
        std::vec![OfferReclaimed {
            offer_id: expired,
            seller: fx.seller.clone(),
        }
        .to_xdr(&env, &fx.escrow_id)]
    );
}

#[test]
fn two_sellers_and_two_tokens_stay_isolated() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);

    let (token_b, token_b_id) = second_token(&env);
    StellarAssetClient::new(&env, &token_b_id).mint(&fx.seller, &(500 * USDC));

    let a = open(&fx);
    let b = fx.escrow.create_offer(
        &fx.seller,
        &token_b_id,
        &(50 * USDC),
        &(2_000 * TRY),
        &3_600,
    );

    // Settling one offer touches only its own token and balance.
    fx.escrow.accept(&fx.buyer, &a);
    fx.escrow.confirm_fiat(&fx.seller, &a);
    assert_eq!(fx.token.balance(&fx.buyer), 100 * USDC);
    assert_eq!(token_b.balance(&fx.buyer), 0);
    assert_eq!(token_b.balance(&fx.escrow_id), 50 * USDC);

    fx.escrow.accept(&fx.carol, &b);
    fx.escrow.confirm_fiat(&fx.seller, &b);
    assert_eq!(token_b.balance(&fx.carol), 50 * USDC);
    assert_eq!(token_b.balance(&fx.escrow_id), 0);
    assert_eq!(fx.token.balance(&fx.buyer), 100 * USDC);
    assert_eq!(fx.escrow.get_offer(&a).unwrap().state, OfferState::Settled);
    assert_eq!(fx.escrow.get_offer(&b).unwrap().state, OfferState::Settled);
}
