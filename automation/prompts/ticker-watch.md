# Playbook: Báo cáo ticker hằng tuần

Làm theo `automation/prompts/_common.md`, với các chi tiết riêng sau.

**Mục tiêu**: một báo cáo tổng hợp cho toàn bộ mã trong `watchlist.tickers`, mỗi mã một mục
phân tích ngắn.

## Dữ liệu cần lấy (cho từng ticker trong watchlist)

1. `get_quote` — giá hiện tại, thay đổi, khối lượng, biên độ 52 tuần.
2. `get_time_series` interval `1week`, outputsize 13 — diễn biến ~3 tháng.
3. (Tùy chọn, nếu còn quota) Alpha Vantage `NEWS_SENTIMENT` cho 2–3 mã biến động mạnh nhất
   để nêu nguyên nhân.

Nhớ chia batch ≤ 8 call/phút. Với 7 ticker × 2 call ≈ 2 đợt.

## Cấu trúc báo cáo

- Front matter: `reportType: ticker`, `tickers:` liệt kê toàn bộ mã, file tên
  `YYYY-MM-DD-ticker-watch.md`.
- Tiêu đề: `"Watchlist tuần: <ngày đầu>–<ngày cuối tuần giao dịch>"`.
- Mở đầu: bảng tổng hợp — mã | giá đóng tuần | %tuần | %4 tuần | so với đỉnh 52 tuần | khối lượng tuần so với trung bình.
- Mỗi ticker một mục `###`: 2–4 câu — xu hướng giá, khối lượng có xác nhận không, mốc giá
  đáng chú ý (đỉnh/đáy gần nhất, biên độ 52 tuần), sự kiện nếu biết (earnings, tin lớn).
- Kết: 2–3 mã đáng theo dõi nhất tuần tới và lý do.
