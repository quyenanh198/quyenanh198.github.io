# Hệ thống báo cáo thị trường tự động

Toàn bộ pipeline chạy tự động bằng GitHub Actions — không cần API key, không cần can thiệp thủ công.

## Cách hoạt động

```
GitHub Actions (cron)
  └─ node scripts/generate-weekly.mjs  (hoặc generate-monthly.mjs)
       ├─ đọc danh sách mã từ src/_data/watchlist.json
       ├─ fetch giá EOD miễn phí: Stooq (chính) → Yahoo Finance (dự phòng)
       ├─ tính toán: % tuần/tháng, sức mạnh tương đối so SPY,
       │  dòng tiền (giá × khối lượng so trung bình), khoảng cách đỉnh 13 tuần…
       ├─ tính chỉ báo kỹ thuật: SMA 20/50/200, RSI(14), MACD(12,26,9), ATR(14)
       ├─ sinh báo cáo markdown tiếng Việt vào src/reports/
       └─ viết bài phân tích tổng hợp vào src/posts/ → hiện trên Blog
          (xu hướng, động lượng, vùng mua / dừng lỗ / chốt lời tham khảo cho từng mã)
  └─ commit báo cáo + bài viết mới vào master
  └─ npm run build (Eleventy) → deploy GitHub Pages
```

## Lịch chạy

| Workflow | Lịch (UTC / giờ VN) | Sản phẩm |
|---|---|---|
| `reports-weekly.yml` | Thứ 7 01:00 UTC (08:00 VN) | Thị trường tuần + Dòng tiền ngành + Watchlist ticker + bài phân tích tuần (blog) |
| `reports-monthly.yml` | Ngày 1 hằng tháng 01:30 UTC (08:30 VN) | Thị trường tháng + bài phân tích tháng (blog) |

Chạy tay bất cứ lúc nào: tab **Actions** trên GitHub → chọn workflow → **Run workflow**,
hoặc local: `npm run reports:weekly` / `npm run reports:monthly`.

## Tùy biến

- **Thêm/bớt mã theo dõi**: sửa `src/_data/watchlist.json` (tickers / benchmarks / sectors) —
  script và trang `/reports/` tự cập nhật theo.
- **Đổi lịch**: sửa `cron` trong 2 file workflow.
- **Đổi nội dung/format báo cáo**: sửa template trong `generate-weekly.mjs` / `generate-monthly.mjs`.

## Ghi chú kỹ thuật

- File báo cáo đặt tên theo ngày giao dịch cuối kỳ (`YYYY-MM-DD-<loại>.md`) nên chạy lại
  trong cùng kỳ sẽ ghi đè thay vì tạo bản trùng — idempotent.
- Script tự bỏ qua mã thiếu dữ liệu và **abort** (không xuất bản gì) nếu thiếu SPY hoặc
  hơn 30% số mã — không bao giờ đăng báo cáo với dữ liệu rỗng.
- Chạy offline để test: đặt `REPORTS_DATA_DIR=<thư mục>` chứa các file `<SYMBOL>.csv`
  định dạng Stooq (`Date,Open,High,Low,Close,Volume`).
