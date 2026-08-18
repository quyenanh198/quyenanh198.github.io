# Playbook: Phân tích dòng tiền luân chuyển giữa các ngành

Làm theo `automation/prompts/_common.md`, với các chi tiết riêng sau.

**Mục tiêu**: đo dòng tiền dịch chuyển giữa 11 nhóm ngành S&P 500 (qua các sector ETF trong
`watchlist.sectors`) trong tuần giao dịch vừa kết thúc.

## Dữ liệu cần lấy

`get_time_series` interval `1week`, outputsize 6 cho từng ETF trong `watchlist.sectors`
(11 mã — chia 2 đợt ≤ 8 call/phút) và cho `SPY` làm chuẩn so sánh.

## Cách tính (làm bằng số liệu thật, tính tay hoặc script nhỏ)

Với mỗi ngành, trên tuần hoàn chỉnh gần nhất:

- **% tuần** = close tuần này / close tuần trước − 1.
- **Sức mạnh tương đối (RS)** = % tuần của ngành − % tuần của SPY.
- **Dòng tiền ước tính (dollar volume)** = close × volume của tuần; so với trung bình
  4 tuần trước đó → tỷ lệ ≥ 1 nghĩa là tiền vào mạnh hơn bình thường.
- Phân loại: **Hút tiền** (RS > 0 và dollar volume ≥ trung bình), **Bị rút tiền** (RS < 0 và
  dollar volume ≥ trung bình — bán chủ động), còn lại là **Trung tính/thiếu thanh khoản**.

## Cấu trúc báo cáo

- Front matter: `reportType: sector-flow`, `tickers:` liệt kê 11 ETF ngành, file tên
  `YYYY-MM-DD-sector-flow.md`.
- Tiêu đề: `"Dòng tiền ngành tuần <ngày đầu>–<ngày cuối>"`.
- Nội dung:
  1. **Bức tranh chung** — 1 đoạn: tiền đang chảy từ đâu sang đâu, thiên hướng risk-on
     (Công nghệ, Tiêu dùng không thiết yếu, Tài chính dẫn dắt) hay phòng thủ (Tiện ích,
     Y tế, Tiêu dùng thiết yếu).
  2. **Bảng xếp hạng** — ngành | %tuần | RS so SPY | dollar volume so trung bình 4 tuần | phân loại.
  3. **Phân tích luân chuyển** — 2–3 đoạn: ngành nào đang được tích lũy nhiều tuần liên tiếp,
     ngành nào bị chốt lời, và sự luân chuyển đó gợi ý gì về khẩu vị rủi ro chung.
  4. **Theo dõi tuần tới** — ngành có tín hiệu đảo chiều sớm.
