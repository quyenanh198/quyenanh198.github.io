# Playbook: Báo cáo thị trường tháng

Làm theo `automation/prompts/_common.md`, với các chi tiết riêng sau.

**Mục tiêu**: tổng hợp thị trường Mỹ trong tháng dương lịch vừa kết thúc (routine chạy ngày 1
hằng tháng → báo cáo cho tháng trước).

## Dữ liệu cần lấy

1. `get_time_series` interval `1month`, outputsize 13 cho từng mã trong `watchlist.benchmarks`
   — tính % tháng, % 3 tháng, % từ đầu năm (YTD).
2. `get_time_series` interval `1month`, outputsize 4 cho 11 ETF ngành trong `watchlist.sectors`
   — xếp hạng ngành theo % tháng (chia 2 đợt ≤ 8 call/phút).
3. (Tùy chọn) Alpha Vantage `TREASURY_YIELD` (lợi suất 10 năm) và `NEWS_SENTIMENT` để nêu
   bối cảnh vĩ mô.

## Cấu trúc báo cáo

- Front matter: `reportType: monthly`, `tickers: [SPY, QQQ, DIA, IWM]`, file tên
  `YYYY-MM-DD-monthly-market.md`.
- Tiêu đề: `"Thị trường tháng <M>/<YYYY>"`.
- Nội dung:
  1. **Tổng quan tháng** — thị trường đi đâu, chế độ thị trường (risk-on/risk-off), bối cảnh vĩ mô.
  2. **Bảng chỉ số** — chỉ số | đóng tháng | %tháng | %3 tháng | %YTD.
  3. **Ngành mạnh nhất / yếu nhất** — bảng xếp hạng 11 ngành theo % tháng, nhận xét nhóm dẫn dắt.
  4. **Nhìn về tháng tới** — chủ đề lớn, rủi ro và mốc đáng theo dõi.
