# backlog.md — Yarım Kalan İşler Ana İndeksi

> Bu dosya, **yarım kalan / devredilen tüm işlerin ana indeksidir.**
> Her worker ve sub-agent, bitiremediği işi `backlog/<task-adı>.md` dosyasına detaylı rapor olarak yazar
> ve buraya tek satırlık kayıt ekler. **Amaç: hiçbir işi asla kaçırmamak.**
>
> İndeks satır formatı:
> `| Tarih | Görev | Worker/Agent | Durum | Rapor | Öncelik |`

## Açık İşler

| Tarih | Görev | Worker/Agent | Durum | Rapor | Öncelik |
|---|---|---|---|---|---|
| — | (henüz açık iş yok) | — | — | — | — |

## Tamamlanan İşler (Arşiv)

| Tarih | Görev | Worker/Agent | Kapatan | Rapor |
|---|---|---|---|---|
| — | — | — | — | — |

---

## Alt Rapor Şablonu — `backlog/<task-adı>.md`

```markdown
# Rapor: <task-adı>
- **Tarih:** YYYY-MM-DD
- **Worker/Agent:** <isim/model>
- **Branch/Worktree:** <branch>
- **PR:** <link veya "yok">

## Yapılanlar
- ...

## Yarım Kalanlar (devredilen)
- ...

## Bloklayıcılar
- ...

## Review Notları
- ...

## Sonraki Adım Önerisi
- ...
```
