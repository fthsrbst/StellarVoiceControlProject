# AGENTS.md — Proje Anayasası

> ⚠️ **SENKRONİZASYON KURALI:** Bu dosya `CLAUDE.md` ile birebir senkrondur.
> Bu dosyada yapılan HER değişiklik `CLAUDE.md`'ye de uygulanmalıdır (ve tersi).
> İki dosya asla farklı içerikte kalmamalıdır.

---

## 1. Ana Modelin Rolü: KOORDİNATÖR

Ana model (sen) bu projede **kod yazmaz, kod okumaz, dosya okumaz.** Ana modelin tek işi koordinasyondur:

- İşleri parçalara böl ve worker agentlara dağıt.
- Worker çıktılarını topla, review sürecini yönet, merge kararlarını ver.
- Workerlar arası çakışmayı önle (dosya/worktree ayrımı).
- `backlog.md`, `sprints.md`, `notes.md` güncellemelerini denetle.

**Kod yazma, kod okuma, dosya okuma, araştırma, test çalıştırma → WORKER işidir.**
Ana model sadece workerlara net, kendi kendine yeten (self-contained) görev tanımları yazar.

---

## 2. Paralel Agent Mimarisi

- Bu projede genelde **paralel agentlarla** çalışılır.
- Her worker **kendi git worktree'sinde** çalışır. İki agent asla aynı worktree'de çalışmaz → kimse kimseyi bloklamaz.
- Her worker işini bitirince kendi branch'inden **PR açar**. Merge sadece PR + review üzerinden olur.
- Ana model, paralel iş başlatırken her worker'a çakışmayan dosya kapsamı (scope) verir.

### Worktree Kuralı
```bash
# Her yeni paralel iş için:
git worktree add .worktrees/<task-adı> -b <branch-adı>
# Worker sadece bu dizinde çalışır.
# PR merge edilince worktree temizlenir:
git worktree remove .worktrees/<task-adı>
```

### Remote Yapısı (Tek Repo)
- **origin** = `n0tnow/StellarVoiceControlProject` — ortak ana repo. Tüm branch'ler, worktree'ler ve PR'lar burada.
- **fork** = `fthsrbst/StellarVoiceControlProject` — kişisel yedek/vitrin; aktif geliştirmede kullanılmaz, ara ara origin ile senkronlanır.
- Fork'a PR açılmaz; tüm PR'lar origin üzerinde branch'ten main'e gider.

---

## 3. Review Zorunluluğu

**Her adımda detaylı review vardır.** Düzgün kod = düzgün proje.

- Hiçbir PR review edilmeden merge edilmez.
- Review için ayrı bir worker (reviewer) görevlendirilir; kodu yazan worker kendi kodunu review edemez.
- Review kriterleri: doğruluk, okunabilirlik, testler, güvenlik, proje konvansiyonlarına uyum.
- Review sonucu (onay/red + gerekçe) `backlog/` altındaki ilgili rapora işlenir.

---

## 4. Caffeinate Kuralı

- Tüm uzun süren işlemlerde agentlar **`caffeinate`** kullanır.
- Build, test, uzun script, uzun worker görevleri `caffeinate -i` ile sarılır:
```bash
caffeinate -i <komut>
```
- Ana model, workera verdiği görev tanımında uzun komutlar için caffeinate kullanımını şart koşar.

---

## 5. Lazy Loading — Doküman Erişim Haritası

Ana modelin context'ini boğmamak için detaylar ayrı dosyalarda tutulur.
**Agent ihtiyaç duyduğunda ilgili dosyayı okur; hepsini önceden yüklemez.**

| Dosya | Ne zaman okunur |
|---|---|
| `notes.md` | Fikir/tartışma geçmişi gerektiğinde; yeni fikir eklenirken |
| `backlog.md` + `backlog/` | Yarım kalan iş sorgulandığında; worker raporu düşülürken |
| `docs/reports/` | Araştırma/arşiv bilgisi gerektiğinde (arama yapılabilir) |
| `docs/model-ladder.md` | Worker seçilirken — **her görev dağıtımından önce okunur** |
| `sprints.md` | Milestone/checklist takibi; görev önceliklendirme |

> ✅ Önemli kuralların tamamı bu dosyada (AGENTS.md) yaşar. Diğer dosyalar detay/veri taşır, kural taşımaz.

---

## 6. Dokümantasyon Görevleri (Her Agent İçin)

- **Hiçbir fikir kaybolmaz:** Tartışılan her fikir `notes.md`'ye tarihli not olarak düşülür.
- **Hiçbir iş kaçmaz:** Yarım kalan her iş, worker/sub-agent tarafından `backlog/<task>.md` raporuyla belgelenir ve `backlog.md` indeksine eklenir.
- **Her araştırma arşivlenir:** Araştırma çıktıları `docs/reports/` altına tarihli dosya olarak konur ve `docs/reports/INDEX.md`'ye işlenir.
- Worker görevini bitirirken her zaman: durum raporu + kalan işler + açılan PR linki döner.

---

## 7. Git & GitHub Disiplini

- **Commit sürekli atılır:** Her anlamlı küçük değişiklik kendi commit'idir. Büyük tek commit yok; atomik, açıklayıcı commit mesajları (conventional commits önerilir: `feat:`, `fix:`, `docs:`, `refactor:`).
- **Push düzenli yapılır:** Worker branch'i sık push'lanır; iş asla sadece lokalde kalmaz.
- **Dokümanlar sürekli güncel tutulur:** Kod değişen her PR'da ilgili `.md` dosyaları da güncellenir (notes/backlog/sprints/reports). Doküman güncellemesi "sonra yapılacak iş" değil, PR'ın parçasıdır.
- **Dokümantasyon için paralel agent açılabilir:** Sub-agent konusunda kısıtımız yok. Ana tur bittiğinde, o turun doküman güncellemeleri (notes.md, backlog raporları, docs/reports/ arşivi, sprints.md checklist) için **paralel dokümantasyon agentı** açılması teşvik edilir — ana akış bloklanmaz.
- **GitHub aktif kullanılır:** PR açıklamaları dolu yazılır (ne/neden/nasıl test edildi), issue varsa PR'a bağlanır, review yorumları PR üzerinden yürür.

---

## 8. İletişim ve Görev Formatı

Workera verilen her görev şunları içerir:
1. **Amaç** — ne, neden yapılıyor
2. **Kapsam** — hangi dosyalar/dizinler (başka dosyaya dokunma)
3. **Worktree/branch adı**
4. **Kabul kriterleri** — nasıl test edilecek
5. **Rapor formatı** — backlog raporu nereye yazılacak

---

*Son güncelleme: 2026-09-19*
