# backlog/ — Worker & Sub-Agent Raporları

Bu klasör, tüm worker ve sub-agent'ların **iş raporlarını** tutar.

- Her yarım kalan (veya devredilen) iş için `backlog/<task-adı>.md` dosyası oluşturulur.
- Şablon için kökteki `backlog.md` dosyasındaki "Alt Rapor Şablonu" bölümüne bak.
- Her rapor, kök `backlog.md` indeksine tek satırla işlenir.
- Sub-agent raporları da burada tutulur; dosya adı `sub-<agent>-<task>.md` formatındadır.

> Kural: Rapor yazılmamış iş, "bitmiş" sayılmaz.
