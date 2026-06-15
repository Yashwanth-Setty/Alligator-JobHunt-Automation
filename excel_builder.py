import logging
import os

log = logging.getLogger("alligator_apply")

HEADERS = [
    "Date Found", "Date Posted", "Source", "Company", "Job Title",
    "Match %", "Tier", "Archetype", "Legitimacy", "Gap",
    "Add to resume 1", "Add to resume 2", "Add to resume 3",
    "Visa", "Apply", "Status", "Notes"
]

COL_WIDTHS = {
    "A": 14, "B": 14, "C": 10, "D": 20, "E": 28,
    "F": 9,  "G": 9,  "H": 14, "I": 14,
    "J": 24, "K": 36, "L": 36, "M": 36,
    "N": 10, "O": 14, "P": 14, "Q": 24,
}

STATUS_OPTIONS = "To Apply,Applied,Interview,Offer,Rejected,Skip"

TITLE_FILL   = "1F3864"
HEADER_FILL  = "1F3864"
SECTION_A    = "1F3864"
SECTION_B    = "2E4057"
GREEN_FILL   = "C6EFCE"
AMBER_FILL   = "FFEB9C"
RED_FILL     = "FFC7CE"


def _write_section_label(ws, row_idx, text, fill_hex, fonts):
    ws.merge_cells(f"A{row_idx}:Q{row_idx}")
    cell           = ws.cell(row=row_idx, column=1, value=text)
    cell.font      = fonts["white_bold_11"]
    cell.fill      = __import__("openpyxl").styles.PatternFill(
        "solid", fgColor=fill_hex
    )
    cell.alignment = __import__("openpyxl").styles.Alignment(
        horizontal="center", vertical="center"
    )
    ws.row_dimensions[row_idx].height = 18
    return row_idx + 1


def _write_data_row(ws, row_idx, job, result, dv, fonts):
    from openpyxl.styles import PatternFill, Font, Alignment

    pct  = result.get("pct", 0)
    tier = result.get("tier", "RED")
    mods = result.get("modifications", [])

    if pct >= 85:
        row_color = GREEN_FILL
    elif pct >= 70:
        row_color = AMBER_FILL
    else:
        row_color = RED_FILL

    row_fill = PatternFill("solid", fgColor=row_color)
    wrap     = Alignment(vertical="top", wrap_text=True)

    from datetime import datetime
    values = [
        datetime.now().strftime("%Y-%m-%d"),
        job.get("date_posted", ""),
        job.get("source",  ""),
        job.get("company", ""),
        job.get("title",   ""),
        pct,
        tier,
        job.get("archetype", ""),
        job.get("legitimacy", ""),
        result.get("gap", ""),
        mods[0] if len(mods) > 0 else "",
        mods[1] if len(mods) > 1 else "",
        mods[2] if len(mods) > 2 else "",
        "OPT OK",
        "",        # Apply — hyperlink set below
        "To Apply",
        "",
    ]

    for col_idx, value in enumerate(values, start=1):
        cell           = ws.cell(row=row_idx, column=col_idx, value=value)
        cell.fill      = row_fill
        cell.alignment = wrap
        if col_idx == 5:
            cell.font = Font(bold=True, size=10)

    # Legitimacy color — column I (9), overrides row fill
    _leg_colors = {"high": "C6EFCE", "medium": "FFEB9C", "low": "FFC7CE"}
    _leg = job.get("legitimacy", "")
    if _leg in _leg_colors:
        ws.cell(row=row_idx, column=9).fill = PatternFill(
            "solid", fgColor=_leg_colors[_leg]
        )

    # Apply hyperlink — column O (15)
    job_url    = job.get("url", "")
    apply_cell = ws.cell(row=row_idx, column=15, value="→ Apply")
    apply_cell.fill      = row_fill
    apply_cell.alignment = wrap
    if job_url:
        apply_cell.hyperlink = job_url
        apply_cell.font      = Font(
            color="0070C0", underline="single", size=9
        )

    dv.add(f"P{row_idx}")
    ws.row_dimensions[row_idx].height = 50
    return row_idx + 1


def build_excel(rows, path):
    try:
        import openpyxl
        from openpyxl.styles import PatternFill, Font, Alignment
        from openpyxl.worksheet.datavalidation import DataValidation

        # Split and sort both sections descending by pct
        top  = sorted(
            [r for r in rows if r[1]["pct"] >= 85],
            key=lambda x: x[1]["pct"],
            reverse=True,
        )
        good = sorted(
            [r for r in rows if 70 <= r[1]["pct"] < 85],
            key=lambda x: x[1]["pct"],
            reverse=True,
        )

        if not top and not good:
            log.info("excel_builder: no rows with pct >= 70")
            return

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Job Pipeline"

        fonts = {
            "white_bold_12": Font(color="FFFFFF", bold=True, size=12),
            "white_bold_11": Font(color="FFFFFF", bold=True, size=11),
            "white_bold_10": Font(color="FFFFFF", bold=True, size=10),
        }

        title_fill  = PatternFill("solid", fgColor=TITLE_FILL)
        header_fill = PatternFill("solid", fgColor=HEADER_FILL)
        center      = Alignment(
            horizontal="center", vertical="center", wrap_text=True
        )

        # Row 1 — master title
        ws.merge_cells("A1:Q1")
        cell           = ws["A1"]
        cell.value     = "Job Hunt Pipeline"
        cell.font      = fonts["white_bold_12"]
        cell.fill      = title_fill
        cell.alignment = center
        ws.row_dimensions[1].height = 30

        # Row 2 — column headers
        for col_idx, header in enumerate(HEADERS, start=1):
            cell           = ws.cell(row=2, column=col_idx, value=header)
            cell.font      = fonts["white_bold_10"]
            cell.fill      = header_fill
            cell.alignment = center
        ws.row_dimensions[2].height = 20

        # Column widths
        for letter, width in COL_WIDTHS.items():
            ws.column_dimensions[letter].width = width

        # Freeze panes at A3
        ws.freeze_panes = "A3"

        # Status dropdown
        dv = DataValidation(
            type="list",
            formula1=f'"{STATUS_OPTIONS}"',
            allow_blank=True,
            showDropDown=False,
        )
        ws.add_data_validation(dv)

        current_row = 3

        # Section A — TOP MATCHES (85%+)
        if top:
            current_row = _write_section_label(
                ws, current_row,
                "TOP MATCHES (85%+)",
                SECTION_A, fonts,
            )
            for job, result in top:
                current_row = _write_data_row(
                    ws, current_row, job, result, dv, fonts
                )

        # Section B — GOOD MATCHES (70-84%)
        if good:
            current_row = _write_section_label(
                ws, current_row,
                "GOOD MATCHES (70-84%)",
                SECTION_B, fonts,
            )
            for job, result in good:
                current_row = _write_data_row(
                    ws, current_row, job, result, dv, fonts
                )

        out_dir = os.path.dirname(path)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)

        wb.save(path)
        log.info(
            f"Excel saved: {path} "
            f"({len(top)} top, {len(good)} good)"
        )

    except Exception as e:
        log.error(f"excel_builder failed: {e}")
