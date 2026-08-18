# Tự động hóa báo cáo thị trường

Thư mục này chứa các "playbook" cho các task Claude chạy định kỳ (Routine). Mỗi routine mở một
phiên Claude mới trong môi trường của repo này, đọc playbook tương ứng, lấy dữ liệu thị trường
qua MCP (Twelve Data / Alpha Vantage), viết báo cáo vào `src/reports/`, rồi commit + push lên
`master` — GitHub Actions sẽ tự build và deploy site.

## Các routine đang chạy

| Routine | Lịch (giờ VN) | Playbook | Sản phẩm |
|---|---|---|---|
| Báo cáo ticker hằng tuần | Thứ 7, 07:00 | `prompts/ticker-watch.md` | Báo cáo cho từng mã trong watchlist |
| Báo cáo thị trường tuần | Thứ 7, 08:00 | `prompts/weekly-market.md` | Tổng hợp tuần: chỉ số, điểm nhấn |
| Dòng tiền ngành hằng tuần | Thứ 7, 09:00 | `prompts/sector-flow.md` | Luân chuyển dòng tiền giữa 11 ngành |
| Báo cáo thị trường tháng | Ngày 1 hằng tháng, 08:00 | `prompts/monthly-market.md` | Tổng hợp tháng |

Muốn đổi nội dung/format báo cáo: **sửa file playbook** tương ứng — routine luôn đọc bản mới nhất
trên `master`. Muốn đổi lịch chạy hoặc tắt: quản lý Routine trên claude.ai (Claude Code → Routines).

## Cấu hình watchlist

Danh sách ticker theo dõi, ETF chỉ số chuẩn và ETF ngành nằm ở `src/_data/watchlist.json`.
Thêm/bớt mã ở đó — cả trang `/reports/` lẫn các báo cáo tự động đều đọc từ file này.

## Cấu trúc một báo cáo

File markdown trong `src/reports/`, tên `YYYY-MM-DD-<loại>.md`, front matter:

```yaml
---
layout: report.njk
title: "Tiêu đề báo cáo"
date: 2026-08-16          # ngày tạo báo cáo
reportType: weekly        # ticker | weekly | monthly | sector-flow
tickers: [SPY, QQQ]       # các mã được đề cập
excerpt: "Tóm tắt một câu hiển thị ở trang danh sách."
---
```

Nội dung viết bằng tiếng Việt, dùng bảng markdown cho số liệu. Trang `/reports/` tự nhóm báo cáo
theo `reportType`.

## Lưu ý giới hạn API

Twelve Data (gói miễn phí): **8 call/phút** — các playbook đều chia batch ≤ 8 call và chờ sang
phút mới giữa các batch. Alpha Vantage dùng cho `TOP_GAINERS_LOSERS` và dữ liệu bổ trợ.
