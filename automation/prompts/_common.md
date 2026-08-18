# Quy trình chung cho mọi báo cáo tự động

Các bước dưới đây áp dụng cho tất cả playbook trong thư mục này. Đọc file này trước, rồi làm
theo playbook cụ thể.

## 1. Chuẩn bị

- Làm việc trên nhánh `master` mới nhất: `git fetch origin master && git checkout master && git pull origin master`.
- Đọc `src/_data/watchlist.json` để lấy danh sách mã (tickers / benchmarks / sectors).
- Ngày giờ: dùng ngày hiện tại (UTC) làm `date` trong front matter. "Tuần trước" nghĩa là tuần
  giao dịch Mỹ đã kết thúc gần nhất (thứ 2 → thứ 6).

## 2. Lấy dữ liệu (Twelve Data MCP)

- Công cụ chính: `get_time_series` (interval `1week` hoặc `1month`, outputsize 6–13) và
  `get_quote`. Bổ trợ: Alpha Vantage `TOP_GAINERS_LOSERS`, `NEWS_SENTIMENT`.
- **Giới hạn 8 call/phút**: gọi tối đa 8 symbol mỗi đợt, giữa các đợt hãy làm việc khác
  (viết nháp, tính toán) hoặc chờ sang phút mới rồi gọi tiếp. Không gọi batch nhiều symbol
  trong một call (không được hỗ trợ).
- Nếu một call lỗi rate-limit, chờ phút sau gọi lại. Nếu một mã lỗi hẳn, ghi chú "thiếu dữ liệu"
  trong báo cáo thay vì bịa số.
- **Tuyệt đối không bịa số liệu.** Mọi con số trong báo cáo phải lấy từ dữ liệu API vừa gọi.

## 3. Viết báo cáo

- File mới trong `src/reports/`, tên `YYYY-MM-DD-<loại>.md` (xem front matter mẫu trong
  `automation/README.md`). Nếu file cùng tên đã tồn tại (chạy lại trong ngày) thì ghi đè.
- Viết **tiếng Việt**, giọng phân tích khách quan, súc tích. Số liệu trình bày bằng bảng
  markdown; nhận định viết thành đoạn văn. Độ dài 400–900 từ.
- Mỗi báo cáo cần: (1) bảng số liệu, (2) nhận định — điều gì đáng chú ý và vì sao,
  (3) điểm cần theo dõi tiếp. Không đưa khuyến nghị mua/bán.

## 4. Kiểm tra và xuất bản

1. `npm ci` (nếu chưa có node_modules) rồi `npm run build` — build phải thành công.
2. Commit với message rõ ràng, ví dụ: `Add weekly market report 2026-08-22`.
3. `git push -u origin master`. Nếu lỗi mạng, thử lại tối đa 4 lần (chờ 2s/4s/8s/16s).
   Nếu push bị reject vì master đã tiến lên, `git pull --rebase origin master` rồi push lại.
4. Push lên `master` sẽ tự kích hoạt GitHub Actions build + deploy — không cần làm gì thêm,
   không tạo pull request.
