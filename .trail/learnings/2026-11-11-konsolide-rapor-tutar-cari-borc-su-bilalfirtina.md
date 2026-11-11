---
title: "Konsolide rapor: tutar/cari borç sütunları kaldırıldı, müşteri fontu ve PDF sığdırma"
author: BilalFirtina
date: 2026-11-11
branch: main
id: l-89268b68
scope: repo
status: active
src: agent
touches:
  - src/components/admin/ConsolidatedDailyReport.tsx
---

Konsolide raporda (IV. Şoför Bazında Müşteri Dökümü) Tutar ve Cari Borç sütunları tamamen kaldırıldı; Tahsilat sütunu kaldı. Mobil kartta da Tutar/Cari Borç alanları ve ara toplamdaki Tutar satırı yok. I. Genel İcmal'deki 'Peşin Ciro (Mal Bedeli)' ve 'Cariye Kalan Borç (Peşin)' satırları bilinçli olarak korundu; bunlar sütun değil günlük özet satırları. Müşteri sütunu fontu masaüstü/PDF'te 14px (text-sm), mobil kartta 12px (text-[12px]); mobilde index.css'teki max-width:639px kuralı .text-xs'i 14px !important yaptığı için kartta arbitrary değer şart. PDF'te teslim edilen ürünlerin tek satıra sığması için tabloya colgroup ile sabit oranlar verildi (3/5/17/6/6/40/11/12) ve print:table-auto kaldırıldı; print:w-auto sınıfları silindi. Doğrulama: derlenmiş CSS ile 794px A4 genişliğinde statik replika, Chrome headless ekran görüntüsü + print-to-pdf.
