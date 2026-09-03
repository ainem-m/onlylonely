import argparse
import os
from pathlib import Path

try:
    from reportlab.lib.colors import HexColor, white
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas
except ModuleNotFoundError as error:
    if error.name == "reportlab":
        raise SystemExit("ReportLabが見つかりません。Python環境へreportlabをインストールしてください。") from None
    raise


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "only_lonely_rules_a4.pdf"
OFFICIAL_URL = "https://www.1101.com/only_lonely/2003-04.html"

INK = HexColor("#151515")
MID = HexColor("#555555")
LIGHT = HexColor("#D9D9D9")
PALE = HexColor("#F5F5F5")


def parse_args():
    parser = argparse.ArgumentParser(description="参加者用ルール説明PDFを生成します。")
    parser.add_argument(
        "--font-regular",
        type=Path,
        default=os.environ.get("ONLY_LONELY_FONT_REGULAR"),
        help="日本語フォント（環境変数 ONLY_LONELY_FONT_REGULAR でも指定可能）",
    )
    parser.add_argument(
        "--font-bold",
        type=Path,
        default=os.environ.get("ONLY_LONELY_FONT_BOLD"),
        help="日本語太字フォント（環境変数 ONLY_LONELY_FONT_BOLD でも指定可能）",
    )
    parser.add_argument(
        "--font-extra-bold",
        type=Path,
        default=os.environ.get("ONLY_LONELY_FONT_EXTRA_BOLD"),
        help="日本語極太フォント（環境変数 ONLY_LONELY_FONT_EXTRA_BOLD でも指定可能）",
    )
    return parser.parse_args()


def register_fonts(font_regular, font_bold, font_extra_bold):
    fonts = [
        ("JP", font_regular, "--font-regular / ONLY_LONELY_FONT_REGULAR"),
        ("JP-Bold", font_bold, "--font-bold / ONLY_LONELY_FONT_BOLD"),
        ("JP-ExtraBold", font_extra_bold, "--font-extra-bold / ONLY_LONELY_FONT_EXTRA_BOLD"),
    ]
    problems = []
    for _, path, setting in fonts:
        if path is None:
            problems.append(f"{setting} が未指定です")
        elif not Path(path).is_file():
            problems.append(f"{setting} で指定したファイルを読み取れません")
    if problems:
        raise SystemExit("フォント設定を確認してください:\n- " + "\n- ".join(problems))

    for name, path, _ in fonts:
        pdfmetrics.registerFont(TTFont(name, str(path)))


def draw_text(c, text, x, y, size=10, font="JP", color=INK):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x, y, text)


def centered_text(c, text, x, y, size=10, font="JP", color=INK):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawCentredString(x, y, text)


def wrapped_lines(text, font, size, max_width):
    lines = []
    for paragraph in text.split("\n"):
        line = ""
        for char in paragraph:
            candidate = line + char
            if line and pdfmetrics.stringWidth(candidate, font, size) > max_width:
                lines.append(line)
                line = char
            else:
                line = candidate
        lines.append(line)
    return lines


def draw_wrapped(c, text, x, y, max_width, size=10, leading=15, font="JP", color=INK):
    c.setFillColor(color)
    c.setFont(font, size)
    for line in wrapped_lines(text, font, size, max_width):
        c.drawString(x, y, line)
        y -= leading
    return y


def rounded_box(c, x, y, width, height, radius=10, fill=None, stroke=LIGHT, line_width=0.8):
    c.setLineWidth(line_width)
    c.setStrokeColor(stroke)
    if fill is None:
        c.setFillColor(white)
        do_fill = 0
    else:
        c.setFillColor(fill)
        do_fill = 1
    c.roundRect(x, y, width, height, radius, stroke=1, fill=do_fill)


def number_circle(c, x, y, number, state="normal", radius=18):
    c.setLineWidth(1.5)
    c.setStrokeColor(INK if state != "muted" else HexColor("#9A9A9A"))
    c.setFillColor(white)
    c.circle(x, y, radius, stroke=1, fill=1)
    centered_text(c, str(number), x, y - 6, 16, "JP-ExtraBold", INK if state != "muted" else MID)
    if state == "muted":
        c.setLineWidth(1.3)
        c.setStrokeColor(MID)
        c.line(x - 12, y + 12, x + 12, y - 12)
    if state == "winner":
        c.setLineWidth(3.5)
        c.setStrokeColor(INK)
        c.circle(x, y, radius + 5, stroke=1, fill=0)


def draw_step(c, x, y, width, number, heading, body):
    centered_text(c, f"STEP {number}", x + width / 2, y, 8, "JP-Bold", MID)
    c.setFillColor(INK)
    c.circle(x + width / 2, y - 28, 18, stroke=0, fill=1)
    centered_text(c, str(number), x + width / 2, y - 34, 16, "JP-ExtraBold", white)
    centered_text(c, heading, x + width / 2, y - 64, 11.5, "JP-Bold", INK)
    lines = wrapped_lines(body, "JP", 9.2, width - 16)
    ty = y - 82
    for line in lines:
        centered_text(c, line, x + width / 2, ty, 9.2, "JP", MID)
        ty -= 13


def build_pdf(font_regular, font_bold, font_extra_bold):
    register_fonts(font_regular, font_bold, font_extra_bold)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    width, height = A4
    c = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    c.setTitle("ONLY LONELY ルール説明")
    c.setAuthor("ONLY LONELY")
    c.setSubject("参加者配布用ルール説明")

    margin = 38
    usable = width - 2 * margin

    # Header: mostly ink-free typography with a single thin rule.
    draw_text(c, "ONLY LONELY", margin, height - 52, 25, "JP-ExtraBold")
    draw_text(c, "参加者用 ルール説明", margin, height - 75, 11, "JP-Bold", MID)
    c.setStrokeColor(INK)
    c.setLineWidth(1.2)
    c.line(margin, height - 88, width - margin, height - 88)

    centered_text(c, "1人だけが選んだ、いちばん小さい数字が勝ち。", width / 2, height - 125, 17, "JP-ExtraBold")
    centered_text(c, "周りとかぶらない小さな数字を、自分だけで考えて選びます。", width / 2, height - 147, 10, "JP", MID)

    # Three-rule overview.
    step_y = height - 184
    col_gap = 10
    col_w = (usable - 2 * col_gap) / 3
    draw_step(c, margin, step_y, col_w, 1, "数字を1つ選ぶ", "1〜18の中から\n1つだけ選びます")
    draw_step(c, margin + col_w + col_gap, step_y, col_w, 2, "かぶった数字は脱落", "同じ数字が2人以上なら\nその数字では勝てません")
    draw_step(c, margin + 2 * (col_w + col_gap), step_y, col_w, 3, "最小の1人が優勝", "1人だけの数字のうち\n最小を選んだ人が勝ち")

    # Example block.
    ex_y = height - 355
    rounded_box(c, margin, ex_y - 150, usable, 150, fill=PALE, stroke=LIGHT)
    draw_text(c, "たとえば", margin + 18, ex_y - 25, 11, "JP-Bold")
    draw_text(c, "4人が選んだ数字", margin + 18, ex_y - 45, 9, "JP", MID)

    circle_y = ex_y - 76
    start_x = margin + 145
    spacing = 68
    number_circle(c, start_x, circle_y, 2, "muted")
    number_circle(c, start_x + spacing, circle_y, 2, "muted")
    number_circle(c, start_x + 2 * spacing, circle_y, 3, "winner")
    number_circle(c, start_x + 3 * spacing, circle_y, 5, "normal")
    centered_text(c, "重複", start_x + spacing / 2, circle_y - 37, 8.5, "JP-Bold", MID)
    centered_text(c, "優勝", start_x + 2 * spacing, circle_y - 37, 8.5, "JP-Bold", INK)

    draw_text(c, "2は2人で重複。3と5は1人ずつ。その中で小さい「3」が優勝です。", margin + 18, ex_y - 128, 10.5, "JP-Bold")

    # Participation flow.
    flow_y = ex_y - 180
    draw_text(c, "投票のしかた", margin, flow_y, 14, "JP-ExtraBold")
    draw_text(c, "司会者の案内に従って、スマートフォンまたは共用端末から投票します。", margin + 90, flow_y + 1, 9.2, "JP", MID)
    c.setStrokeColor(LIGHT)
    c.setLineWidth(0.8)
    c.line(margin, flow_y - 12, width - margin, flow_y - 12)

    flow_items = [
        ("1", "QRを読み取る", "自分のカード、または\n案内された端末を使う"),
        ("2", "数字を選ぶ", "名前と数字を\n最終画面で確認する"),
        ("3", "投票を確定", "完了画面を確認して\n結果発表を待つ"),
    ]
    item_y = flow_y - 48
    for i, (num, heading, body) in enumerate(flow_items):
        x = margin + i * (usable / 3)
        c.setFillColor(INK)
        c.circle(x + 12, item_y + 2, 11, stroke=0, fill=1)
        centered_text(c, num, x + 12, item_y - 2, 9, "JP-Bold", white)
        draw_text(c, heading, x + 31, item_y - 2, 10.5, "JP-Bold")
        draw_wrapped(c, body, x + 31, item_y - 20, usable / 3 - 40, 8.6, 12, "JP", MID)
        if i < 2:
            draw_text(c, ">", x + usable / 3 - 12, item_y - 3, 13, "JP-Bold", MID)

    # Important notes.
    note_y = flow_y - 132
    rounded_box(c, margin, note_y - 91, usable, 91, fill=None, stroke=INK, line_width=1.0)
    draw_text(c, "大切なこと", margin + 16, note_y - 23, 11, "JP-ExtraBold")
    notes = [
        "相談は禁止。数字はほかの人に見せず、自分だけで決めてください。",
        "投票後は自分で変更できません。名前や数字を間違えたら司会者へ。",
        "1人だけの数字が1つもなければ、今回は優勝者なしです。",
    ]
    ny = note_y - 44
    for note in notes:
        c.setFillColor(INK)
        c.circle(margin + 20, ny + 3, 2, stroke=0, fill=1)
        draw_text(c, note, margin + 30, ny, 9.2, "JP")
        ny -= 18

    # Footer. The page deliberately leaves breathing room below the notes so the
    # handout remains easy to scan and does not consume ink with decoration.
    c.setStrokeColor(LIGHT)
    c.setLineWidth(0.6)
    c.line(margin, 38, width - margin, 38)
    draw_text(c, "ONLY LONELY", margin, 24, 7.5, "JP-Bold", MID)
    c.setFont("JP", 7.5)
    c.setFillColor(MID)
    c.drawRightString(width - margin, 24, "非公式・非公認Web実装 / 公式企画: " + OFFICIAL_URL)

    c.showPage()
    c.save()
    print(OUTPUT)


if __name__ == "__main__":
    args = parse_args()
    build_pdf(args.font_regular, args.font_bold, args.font_extra_bold)
