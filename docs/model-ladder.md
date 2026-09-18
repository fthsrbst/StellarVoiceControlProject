# Model Merdiveni — Worker Sıralaması ve Kullanım Yöntemleri

> Bu dosya, koordinatörün görev dağıtırken **hangi worker'ı seçeceğini** tanımlar.
> Koordinatör her görev dağıtımından önce bu dosyayı okur (lazy loading).
> Model isimleri ortama göre güncellenir; mantık sabittir: **görev zorluğuna göre en düşük yeterli seviye kullanılır.**

---

## Merdiven (yukarıdan aşağıya)

| Seviye | Rol | Tipik Model Sınıfı | Kullanım |
|---|---|---|---|
| L0 | Koordinatör (ana model) | En güçlü model | Sadece koordinasyon; kod/dosya okuma-yazma YAPMAZ |
| L1 | Senior Worker | Güçlü model | Mimari kararlar, karmaşık implementasyon, zor debug, PR review (kritik) |
| L2 | Mid Worker | Orta model | Standart feature geliştirme, test yazımı, refactor, dokümantasyon |
| L3 | Junior Worker | Hafif/hızlı model | Basit dosya işlemleri, formatlama, grep/arama, rapor derleme, boilerplate |
| L4 | Reviewer | Görev kritikliğine göre L1/L2 | PR review; kodu yazan worker ile aynı agent OLAMAZ |

---

## Kullanım Yöntemleri

### 1. Görev → Seviye Eşleştirmesi
- Görevi al → zorluğunu sınıflandır (trivial / standart / karmaşık) → **en düşük yeterli seviyeyi** seç.
- Pahalı modeli basit işte kullanma; hafif modeli kritik işte kullanma.

### 2. Paralel Dağıtım
- Bağımsız görevler aynı anda farklı worktree'lerde farklı workerlara verilir.
- Aynı dosya kapsamına dokunan iki görev asla paralelleştirilmez (sıraya alınır).

### 3. Eskalasyon
- Worker takılırsa veya işi bitiremezse: raporunu `backlog/` altına düşer → koordinatör işi bir üst seviyeye eskale eder.
- Eskalasyon zinciri: L3 → L2 → L1. L1 çözemezse koordinatör kullanıcıya danışır.

### 4. Review Eşleştirmesi
- Kritik modül PR'ı → L1 reviewer. Standart PR → L2 reviewer.
- Reviewer ile yazar asla aynı worktree/agent değildir.

### 5. Sub-Agent Raporlama
- Her seviyedeki worker/sub-agent, görev sonunda raporunu `backlog/` klasörüne yazar (şablon: `backlog.md`).

---

## Model Eşleştirme Tablosu (ortama göre doldurulur)

| Seviye | Kullanılacak Model | Not |
|---|---|---|
| L0 | (ana model — bu oturum) | Koordinatör |
| L1 | <doldurulacak> | |
| L2 | <doldurulacak> | |
| L3 | <doldurulacak> | |
| L4 | <doldurulacak> | |

> Ortamdaki kullanılabilir modeller netleştiğinde bu tablo güncellenir.
