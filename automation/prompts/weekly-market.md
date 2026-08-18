# Playbook: Báo cáo thị trường tuần

Làm theo `automation/prompts/_common.md`, với các chi tiết riêng sau.

**Mục tiêu**: tổng hợp thị trường Mỹ trong tuần giao dịch vừa kết thúc.

## Dữ liệu cần lấy

1. `get_time_series` interval `1week`, outputsize 8 cho từng mã trong `watchlist.benchmarks`
   (SPY, QQQ, DIA, IWM) — tính % tuần, % 4 tuần.
2. Alpha Vantage `TOP_GAINERS_LOSERS` — top tăng/giảm/khối lượng.
3. (Tùy chọn) `get_quote` cho mã biến động nổi bật; Alpha Vantage `NEWS_SENTIMENT`
   (topics `financial_markets`, `economy_macro`) để nắm bối cảnh tin tức tuần.

## Cấu trúc báo cáo

- Front matter: `reportType: weekly`, `tickers: [SPY, QQQ, DIA, IWM]`, file tên
  `YYYY-MM-DD-weekly-market.md`.
- Tiêu đề: `"Thị trường tuần <ngày đầu>–<ngày cuối>"`.
- Nội dung:
  1. **Tổng quan** — 1 đoạn: thị trường tăng/giảm, nhóm dẫn dắt, bối cảnh chính.
  2. **Bảng chỉ số** — chỉ số | đóng tuần | %tuần | %4 tuần | nhận xét ngắn.
  3. **Điểm nhấn** — 2–4 gạch đầu dòng: cổ phiếu/nhóm nổi bật, top movers từ
     TOP_GAINERS_LOSERS, sự kiện vĩ mô nếu có.
  4. **Tuần tới** — sự kiện/dữ liệu đáng chờ (lịch earnings, dữ liệu kinh tế nếu biết),
     mốc kỹ thuật cần quan sát trên SPY/QQQ.
