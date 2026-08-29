import ExcelJS from "exceljs";

import { currentUser, jsonError } from "@/lib/auth";
import { normalizeRole, ROLES, type Role } from "@/lib/database";
import { callGoogleBackend } from "@/lib/google-backend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AttendanceRow = {
  id: string;
  user_id: string;
  username: string;
  name: string;
  role: string;
  work_date: string;
  check_in_at: string;
  check_in_lat: number;
  check_in_lng: number;
  check_in_accuracy: number;
  check_in_file_id: string;
  check_out_at: string | null;
  check_out_lat: number | null;
  check_out_lng: number | null;
  check_out_accuracy: number | null;
  check_out_file_id: string | null;
};

type ReportStatus = "complete" | "open";

type ReportFilters = {
  from: string;
  to: string;
  role: Role | "";
  status: ReportStatus | "";
  query: string;
};

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const MAX_REPORT_ROWS = 5_000;
const MAX_QUERY_LENGTH = 200;
const EMPLOYEE_HEADER_ROW = 5;
const EMPLOYEE_COLUMN_COUNT = 13;
const DETAIL_HEADER_ROW = 5;
const DETAIL_COLUMN_COUNT = 18;

const COLORS = {
  ink: "FF10211C",
  muted: "FF6F7E78",
  brand: "FFED5F42",
  brandDark: "FFC9432B",
  green: "FF1B7A55",
  amber: "FFB26F18",
  paper: "FFF4F5EF",
  cream: "FFFFF8F2",
  white: "FFFFFFFF",
  line: "FFDFE4DC",
  blue: "FF2F659C",
};

const ROLE_LABELS: Record<Role, string> = {
  user: "ผู้ใช้งาน",
  admin: "ผู้ดูแลระบบ",
  hr: "ฝ่ายบุคคล (HR)",
  "employee-driver": "พนักงานขับรถ",
  "employee-office": "พนักงานสำนักงาน",
};

const STATUS_LABELS: Record<ReportStatus, string> = {
  complete: "เข้างาน–เลิกงานครบ",
  open: "ยังไม่เลิกงาน",
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: COLORS.line } },
  left: { style: "thin", color: { argb: COLORS.line } },
  bottom: { style: "thin", color: { argb: COLORS.line } },
  right: { style: "thin", color: { argb: COLORS.line } },
};

function safeText(value: unknown, maxLength = 32_000) {
  let result = "";
  for (const character of String(value ?? "")) {
    const codePoint = character.codePointAt(0) || 0;
    if (codePoint <= 8 || codePoint === 11 || codePoint === 12 || (codePoint >= 14 && codePoint <= 31)) continue;
    result += character;
    if (result.length >= maxLength) break;
  }
  return result.slice(0, maxLength);
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseFilters(url: URL): { filters?: ReportFilters; error?: string } {
  const from = (url.searchParams.get("from") || "").trim();
  const to = (url.searchParams.get("to") || "").trim();
  const roleValue = (url.searchParams.get("role") || "").trim().toLowerCase().replaceAll("_", "-");
  const statusValue = (url.searchParams.get("status") || "").trim().toLowerCase();
  const query = (url.searchParams.get("q") || "").trim();

  if (from && !isIsoDate(from)) return { error: "invalid_from" };
  if (to && !isIsoDate(to)) return { error: "invalid_to" };
  if (from && to && from > to) return { error: "invalid_date_range" };
  if (roleValue && !ROLES.includes(roleValue as Role)) return { error: "invalid_role" };
  if (statusValue && statusValue !== "complete" && statusValue !== "open") return { error: "invalid_status" };
  if (query.length > MAX_QUERY_LENGTH) return { error: "query_too_long" };

  return {
    filters: {
      from,
      to,
      role: roleValue as Role | "",
      status: statusValue as ReportStatus | "",
      query,
    },
  };
}

function normalizedSearch(value: unknown) {
  return safeText(value, 500).normalize("NFKC").toLocaleLowerCase("th-TH");
}

function hasCheckedOut(row: AttendanceRow) {
  return Boolean(safeText(row.check_out_at, 100).trim());
}

function filterRows(rows: AttendanceRow[], filters: ReportFilters) {
  const query = normalizedSearch(filters.query);

  return rows.filter((row) => {
    const workDate = safeText(row.work_date, 10);
    const role = normalizeRole(row.role);
    const complete = hasCheckedOut(row);

    if (filters.from && (!isIsoDate(workDate) || workDate < filters.from)) return false;
    if (filters.to && (!isIsoDate(workDate) || workDate > filters.to)) return false;
    if (filters.role && role !== filters.role) return false;
    if (filters.status === "complete" && !complete) return false;
    if (filters.status === "open" && complete) return false;
    if (!query) return true;

    return [
      row.user_id,
      row.username,
      row.name,
      row.role,
      role,
      ROLE_LABELS[role],
      workDate,
    ].some((value) => normalizedSearch(value).includes(query));
  }).sort((left, right) => {
    const dateOrder = safeText(right.work_date, 10).localeCompare(safeText(left.work_date, 10));
    if (dateOrder !== 0) return dateOrder;
    const rightTime = Date.parse(safeText(right.check_in_at, 100));
    const leftTime = Date.parse(safeText(left.check_in_at, 100));
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
}

function durationHours(row: AttendanceRow) {
  if (!row.check_out_at) return null;
  const checkIn = Date.parse(safeText(row.check_in_at, 100));
  const checkOut = Date.parse(safeText(row.check_out_at, 100));
  if (!Number.isFinite(checkIn) || !Number.isFinite(checkOut) || checkOut < checkIn) return null;
  return Math.round(((checkOut - checkIn) / 3_600_000) * 100) / 100;
}

function excelDateOnly(value: unknown) {
  const date = safeText(value, 10);
  return isIsoDate(date) ? new Date(`${date}T00:00:00.000Z`) : null;
}

function excelBangkokDateTime(value: unknown) {
  const parsed = new Date(safeText(value, 100));
  if (Number.isNaN(parsed.getTime())) return null;
  // XLSX has no timezone. Shift the instant so Excel displays Bangkok wall-clock time.
  return new Date(parsed.getTime() + BANGKOK_OFFSET_MS);
}

function finiteCoordinate(latValue: unknown, lngValue: unknown) {
  if (latValue === null || latValue === undefined || latValue === "" || lngValue === null || lngValue === undefined || lngValue === "") return null;
  const lat = Number(latValue);
  const lng = Number(lngValue);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function finiteMetric(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function coordinateText(coordinate: { lat: number; lng: number } | null) {
  return coordinate ? `${coordinate.lat.toFixed(6)}, ${coordinate.lng.toFixed(6)}` : "-";
}

function mapUrl(coordinate: { lat: number; lng: number } | null) {
  if (!coordinate) return "";
  return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(coordinate.lat)}&mlon=${encodeURIComponent(coordinate.lng)}#map=16/${encodeURIComponent(coordinate.lat)}/${encodeURIComponent(coordinate.lng)}`;
}

function protectedPhotoUrl(origin: string, fileId: unknown) {
  const id = safeText(fileId, 500).trim();
  if (!id) return "";
  const url = new URL("/api/photo", origin);
  url.searchParams.set("id", id);
  return url.toString();
}

// ใช้ dd/mm/yyyy ปี ค.ศ. เหมือนในแอป — th-TH จะได้ปี พ.ศ. ซึ่งอ่านสลับกับตัวเลขในชีต
function thaiDateLabel(value: string) {
  if (!isIsoDate(value)) return "ไม่ระบุ";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function generatedAtLabel() {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "long",
    timeStyle: "medium",
    timeZone: "Asia/Bangkok",
  }).format(new Date());
}

function reportDateRange(rows: AttendanceRow[], filters: ReportFilters) {
  const dates = rows.map((row) => safeText(row.work_date, 10)).filter(isIsoDate).sort();
  const first = filters.from || dates[0] || "";
  const last = filters.to || dates.at(-1) || "";

  if (first && last) return `${thaiDateLabel(first)} ถึง ${thaiDateLabel(last)}`;
  if (first) return `ตั้งแต่ ${thaiDateLabel(first)}`;
  if (last) return `ถึง ${thaiDateLabel(last)}`;
  return "ทุกช่วงวันที่";
}

function employeeKey(row: AttendanceRow) {
  return safeText(row.user_id || row.username || row.name, 500);
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

type EmployeeSummary = {
  userId: string;
  username: string;
  name: string;
  role: Role;
  days: number;
  records: number;
  completed: number;
  open: number;
  totalHours: number;
  averageHours: number;
  firstDate: string;
  lastDate: string;
};

/** จัดกลุ่มรายการลงเวลาเป็นรายคน — ชีตที่ฝ่ายบุคคลใช้ตั้งต้นคิดวันทำงานและชั่วโมงรวม */
function employeeSummary(rows: AttendanceRow[]): EmployeeSummary[] {
  const groups = new Map<string, AttendanceRow[]>();
  rows.forEach((row) => {
    const key = employeeKey(row) || safeText(row.name, 500);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  });

  return [...groups.values()].map((group) => {
    const durations = group.map(durationHours).filter((value): value is number => value !== null);
    const dates = group.map((row) => safeText(row.work_date, 10)).filter(isIsoDate).sort();
    const completed = group.filter(hasCheckedOut).length;
    // rows ถูกเรียงใหม่สุดมาก่อนแล้ว แถวแรกของกลุ่มจึงเป็นชื่อ/ตำแหน่งล่าสุดของคนนั้น
    const latest = group[0];
    return {
      userId: safeText(latest.user_id, 500),
      username: safeText(latest.username, 500),
      name: safeText(latest.name, 1_000),
      role: normalizeRole(latest.role),
      days: new Set(dates).size,
      records: group.length,
      completed,
      open: group.length - completed,
      totalHours: Math.round(durations.reduce((total, value) => total + value, 0) * 100) / 100,
      averageHours: average(durations),
      firstDate: dates[0] || "",
      lastDate: dates.at(-1) || "",
    };
  }).sort((left, right) => left.name.localeCompare(right.name, "th") || left.username.localeCompare(right.username));
}

function roleSummary(rows: AttendanceRow[]) {
  return ROLES.map((role) => {
    const roleRows = rows.filter((row) => normalizeRole(row.role) === role);
    const completed = roleRows.filter(hasCheckedOut).length;
    const durations = roleRows.map(durationHours).filter((value): value is number => value !== null);
    return {
      role,
      employees: new Set(roleRows.map(employeeKey).filter(Boolean)).size,
      records: roleRows.length,
      completed,
      open: roleRows.length - completed,
      completionRate: roleRows.length ? completed / roleRows.length : 0,
      averageHours: average(durations),
    };
  });
}

function solidFill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function styleTitle(sheet: ExcelJS.Worksheet, title: string, subtitle: string, lastColumn: number) {
  sheet.mergeCells(1, 1, 1, lastColumn);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { name: "Leelawadee UI", size: 20, bold: true, color: { argb: COLORS.white } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  titleCell.fill = solidFill(COLORS.ink);
  sheet.getRow(1).height = 38;

  sheet.mergeCells(2, 1, 2, lastColumn);
  const subtitleCell = sheet.getCell(2, 1);
  subtitleCell.value = subtitle;
  subtitleCell.font = { name: "Leelawadee UI", size: 11, bold: true, color: { argb: COLORS.brandDark } };
  subtitleCell.alignment = { vertical: "middle", horizontal: "left" };
  subtitleCell.fill = solidFill(COLORS.cream);
  sheet.getRow(2).height = 25;

  sheet.mergeCells(3, 1, 3, lastColumn);
  const generatedCell = sheet.getCell(3, 1);
  generatedCell.value = `จัดทำเมื่อ ${generatedAtLabel()} · เวลาในรายงานเป็นเขตเวลาเอเชีย/กรุงเทพฯ`;
  generatedCell.font = { name: "Leelawadee UI", size: 9, color: { argb: COLORS.muted } };
  generatedCell.alignment = { vertical: "middle", horizontal: "left" };
  sheet.getRow(3).height = 22;
}

function styleSectionTitle(sheet: ExcelJS.Worksheet, rowNumber: number, title: string, lastColumn: number) {
  sheet.mergeCells(rowNumber, 1, rowNumber, lastColumn);
  const cell = sheet.getCell(rowNumber, 1);
  cell.value = title;
  cell.font = { name: "Leelawadee UI", size: 11, bold: true, color: { argb: COLORS.white } };
  cell.fill = solidFill(COLORS.brand);
  cell.alignment = { vertical: "middle", horizontal: "left" };
  sheet.getRow(rowNumber).height = 25;
}

function styleTableHeader(row: ExcelJS.Row) {
  row.height = 34;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { name: "Leelawadee UI", size: 10, bold: true, color: { argb: COLORS.white } };
    cell.fill = solidFill(COLORS.ink);
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = THIN_BORDER;
  });
}

function mergeAndStyleCard(
  sheet: ExcelJS.Worksheet,
  labelRange: string,
  valueRange: string,
  label: string,
  value: string | number,
  valueColor = COLORS.ink,
) {
  sheet.mergeCells(labelRange);
  sheet.mergeCells(valueRange);
  const labelCell = sheet.getCell(labelRange.split(":")[0]);
  labelCell.value = label;
  labelCell.font = { name: "Leelawadee UI", size: 9, bold: true, color: { argb: COLORS.muted } };
  labelCell.fill = solidFill(COLORS.paper);
  labelCell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  labelCell.border = THIN_BORDER;

  const valueCell = sheet.getCell(valueRange.split(":")[0]);
  valueCell.value = value;
  valueCell.font = { name: "Leelawadee UI", size: 18, bold: true, color: { argb: valueColor } };
  valueCell.fill = solidFill(COLORS.white);
  valueCell.alignment = { vertical: "middle", horizontal: "center" };
  valueCell.border = THIN_BORDER;
}

function addSummarySheet(
  workbook: ExcelJS.Workbook,
  rows: AttendanceRow[],
  filters: ReportFilters,
  rangeLabel: string,
  sourceWasCapped: boolean,
) {
  const sheet = workbook.addWorksheet("สรุปรายงาน", {
    views: [{ state: "frozen", ySplit: 4, showGridLines: false }],
    properties: { defaultRowHeight: 20 },
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
      margins: { left: 0.25, right: 0.25, top: 0.55, bottom: 0.55, header: 0.2, footer: 0.2 },
    },
  });
  for (let column = 1; column <= 10; column += 1) sheet.getColumn(column).width = 14;

  styleTitle(sheet, "T TIME · รายงานการเข้างาน–เลิกงาน", `ช่วงรายงาน: ${rangeLabel}`, 10);

  const completed = rows.filter(hasCheckedOut).length;
  const open = rows.length - completed;
  const durations = rows.map(durationHours).filter((value): value is number => value !== null);
  const uniqueEmployees = new Set(rows.map(employeeKey).filter(Boolean)).size;

  mergeAndStyleCard(sheet, "A5:B5", "A6:B7", "รายการลงเวลา", rows.length, COLORS.brandDark);
  mergeAndStyleCard(sheet, "C5:D5", "C6:D7", "พนักงานทั้งหมด", uniqueEmployees);
  mergeAndStyleCard(sheet, "E5:F5", "E6:F7", "รายการครบถ้วน", completed, COLORS.green);
  mergeAndStyleCard(sheet, "G5:H5", "G6:H7", "ยังไม่เลิกงาน", open, open ? COLORS.amber : COLORS.green);
  mergeAndStyleCard(sheet, "I5:J5", "I6:J7", "ชั่วโมงทำงานเฉลี่ย", average(durations), COLORS.blue);
  sheet.getCell("I6").numFmt = "0.00";
  sheet.getRow(5).height = 24;
  sheet.getRow(6).height = 26;
  sheet.getRow(7).height = 26;

  styleSectionTitle(sheet, 9, "สรุปตามตำแหน่ง / สิทธิ์ผู้ใช้งาน", 10);
  const roleHeader = sheet.getRow(10);
  sheet.mergeCells("A10:B10");
  sheet.mergeCells("G10:H10");
  sheet.mergeCells("I10:J10");
  roleHeader.getCell(1).value = "ตำแหน่ง / สิทธิ์";
  roleHeader.getCell(3).value = "จำนวนพนักงาน";
  roleHeader.getCell(4).value = "รายการลงเวลา";
  roleHeader.getCell(5).value = "ครบถ้วน";
  roleHeader.getCell(6).value = "ยังไม่เลิกงาน";
  roleHeader.getCell(7).value = "อัตราครบถ้วน";
  roleHeader.getCell(9).value = "ชั่วโมงเฉลี่ย";
  styleTableHeader(roleHeader);

  roleSummary(rows).forEach((summary, index) => {
    const rowNumber = 11 + index;
    const row = sheet.getRow(rowNumber);
    sheet.mergeCells(`A${rowNumber}:B${rowNumber}`);
    sheet.mergeCells(`G${rowNumber}:H${rowNumber}`);
    sheet.mergeCells(`I${rowNumber}:J${rowNumber}`);
    row.getCell(1).value = `${ROLE_LABELS[summary.role]} (${summary.role})`;
    row.getCell(3).value = summary.employees;
    row.getCell(4).value = summary.records;
    row.getCell(5).value = summary.completed;
    row.getCell(6).value = summary.open;
    row.getCell(7).value = summary.completionRate;
    row.getCell(7).numFmt = "0.00%";
    row.getCell(9).value = summary.averageHours;
    row.getCell(9).numFmt = "0.00";
    row.height = 24;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { name: "Leelawadee UI", size: 10, color: { argb: COLORS.ink } };
      cell.fill = solidFill(index % 2 === 0 ? COLORS.white : COLORS.paper);
      cell.alignment = { vertical: "middle", horizontal: columnNumber === 1 ? "left" : "center", wrapText: true };
      cell.border = THIN_BORDER;
    });
  });

  styleSectionTitle(sheet, 17, "ตัวกรองที่ใช้จัดทำรายงาน", 10);
  const criteria: Array<[string, string, string, string]> = [
    ["วันที่เริ่ม", filters.from ? thaiDateLabel(filters.from) : "ไม่จำกัด", "วันที่สิ้นสุด", filters.to ? thaiDateLabel(filters.to) : "ไม่จำกัด"],
    ["ตำแหน่ง / สิทธิ์", filters.role ? `${ROLE_LABELS[filters.role]} (${filters.role})` : "ทั้งหมด", "สถานะ", filters.status ? STATUS_LABELS[filters.status] : "ทั้งหมด"],
  ];
  criteria.forEach((values, index) => {
    const rowNumber = 18 + index;
    const row = sheet.getRow(rowNumber);
    sheet.mergeCells(`A${rowNumber}:B${rowNumber}`);
    sheet.mergeCells(`C${rowNumber}:E${rowNumber}`);
    sheet.mergeCells(`F${rowNumber}:G${rowNumber}`);
    sheet.mergeCells(`H${rowNumber}:J${rowNumber}`);
    row.getCell(1).value = values[0];
    row.getCell(3).value = values[1];
    row.getCell(6).value = values[2];
    row.getCell(8).value = values[3];
    [1, 6].forEach((column) => {
      const cell = row.getCell(column);
      cell.font = { name: "Leelawadee UI", size: 9, bold: true, color: { argb: COLORS.muted } };
      cell.fill = solidFill(COLORS.paper);
      cell.alignment = { vertical: "middle", horizontal: "left" };
      cell.border = THIN_BORDER;
    });
    [3, 8].forEach((column) => {
      const cell = row.getCell(column);
      cell.font = { name: "Leelawadee UI", size: 10, color: { argb: COLORS.ink } };
      cell.fill = solidFill(COLORS.white);
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      cell.border = THIN_BORDER;
    });
    row.height = 25;
  });

  sheet.mergeCells("A20:B20");
  sheet.mergeCells("C20:J20");
  const queryLabel = sheet.getCell("A20");
  queryLabel.value = "คำค้นหา";
  queryLabel.font = { name: "Leelawadee UI", size: 9, bold: true, color: { argb: COLORS.muted } };
  queryLabel.fill = solidFill(COLORS.paper);
  queryLabel.alignment = { vertical: "middle", horizontal: "left" };
  queryLabel.border = THIN_BORDER;
  const queryValue = sheet.getCell("C20");
  queryValue.value = filters.query || "ไม่ระบุ";
  queryValue.font = { name: "Leelawadee UI", size: 10, color: { argb: COLORS.ink } };
  queryValue.fill = solidFill(COLORS.white);
  queryValue.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  queryValue.border = THIN_BORDER;
  sheet.getRow(20).height = 25;

  sheet.mergeCells("A22:J22");
  const note = sheet.getCell("A22");
  note.value = sourceWasCapped
    ? `หมายเหตุ: รายงานนี้แสดงข้อมูลสูงสุด ${MAX_REPORT_ROWS.toLocaleString("th-TH")} รายการ โปรดจำกัดช่วงวันที่เพื่อความครบถ้วน`
    : "หมายเหตุ: ชั่วโมงทำงานคำนวณจากเวลาเข้างานถึงเวลาเลิกงาน และเฉลี่ยเฉพาะรายการที่มีเวลาถูกต้อง";
  note.font = { name: "Leelawadee UI", size: 9, italic: true, color: { argb: sourceWasCapped ? COLORS.brandDark : COLORS.muted } };
  note.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  note.fill = solidFill(sourceWasCapped ? COLORS.cream : COLORS.paper);
  sheet.getRow(22).height = 30;

  sheet.headerFooter.oddFooter = "&Lข้อมูลภายในองค์กร · T TIME&Rหน้า &P / &N";
  sheet.pageSetup.printTitlesRow = "1:3";
}

function addEmployeeSheet(workbook: ExcelJS.Workbook, rows: AttendanceRow[], rangeLabel: string) {
  const sheet = workbook.addWorksheet("สรุปรายบุคคล", {
    views: [{ state: "frozen", xSplit: 4, ySplit: EMPLOYEE_HEADER_ROW, topLeftCell: "E6", activeCell: "E6", showGridLines: false }],
    properties: { defaultRowHeight: 21 },
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
      margins: { left: 0.25, right: 0.25, top: 0.55, bottom: 0.55, header: 0.2, footer: 0.2 },
    },
  });

  const widths = [7, 18, 18, 26, 24, 14, 14, 12, 14, 14, 16, 16, 16];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });

  const summaries = employeeSummary(rows);
  styleTitle(
    sheet,
    "T TIME · สรุปเวลาทำงานรายบุคคล",
    `ช่วงรายงาน: ${rangeLabel} · ${summaries.length.toLocaleString("th-TH")} คน`,
    EMPLOYEE_COLUMN_COUNT,
  );

  const header = sheet.getRow(EMPLOYEE_HEADER_ROW);
  header.values = [
    "ลำดับ",
    "รหัสผู้ใช้",
    "ชื่อผู้ใช้",
    "ชื่อ–นามสกุล",
    "ตำแหน่ง / สิทธิ์",
    "จำนวนวันทำงาน",
    "รายการลงเวลา",
    "ลงเวลาครบ",
    "ยังไม่เลิกงาน",
    "ชั่วโมงรวม",
    "ชั่วโมงเฉลี่ย/รายการ",
    "ลงเวลาครั้งแรก",
    "ลงเวลาล่าสุด",
  ];
  styleTableHeader(header);

  if (!summaries.length) {
    sheet.mergeCells(6, 1, 6, EMPLOYEE_COLUMN_COUNT);
    const empty = sheet.getCell(6, 1);
    empty.value = "ไม่พบข้อมูลที่ตรงกับตัวกรอง";
    empty.font = { name: "Leelawadee UI", size: 11, italic: true, color: { argb: COLORS.muted } };
    empty.alignment = { vertical: "middle", horizontal: "center" };
    empty.fill = solidFill(COLORS.paper);
    empty.border = THIN_BORDER;
    sheet.getRow(6).height = 42;
  }

  summaries.forEach((summary, index) => {
    const rowNumber = EMPLOYEE_HEADER_ROW + 1 + index;
    const row = sheet.getRow(rowNumber);
    row.values = [
      index + 1,
      summary.userId,
      summary.username,
      summary.name,
      `${ROLE_LABELS[summary.role]} (${summary.role})`,
      summary.days,
      summary.records,
      summary.completed,
      summary.open,
      summary.totalHours,
      summary.averageHours,
      excelDateOnly(summary.firstDate) || "-",
      excelDateOnly(summary.lastDate) || "-",
    ];
    row.getCell(10).numFmt = "0.00";
    row.getCell(11).numFmt = "0.00";
    [12, 13].forEach((column) => { if (row.getCell(column).value instanceof Date) row.getCell(column).numFmt = "dd/mm/yyyy"; });
    row.height = 25;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { name: "Leelawadee UI", size: 10, color: { argb: COLORS.ink } };
      cell.fill = solidFill(index % 2 === 0 ? COLORS.white : COLORS.paper);
      cell.alignment = { vertical: "middle", horizontal: [2, 3, 4, 5].includes(columnNumber) ? "left" : "center", wrapText: true };
      cell.border = THIN_BORDER;
    });
    // ใบที่ยังไม่ปิดเวลาเลิกงานคือรายการที่ฝ่ายบุคคลต้องตามแก้ ทำให้เห็นชัดตั้งแต่ชีตแรก
    if (summary.open > 0) {
      const openCell = row.getCell(9);
      openCell.font = { name: "Leelawadee UI", size: 10, bold: true, color: { argb: COLORS.amber } };
      openCell.fill = solidFill("FFFBEFD8");
    }
  });

  if (summaries.length) {
    const totalRowNumber = EMPLOYEE_HEADER_ROW + 1 + summaries.length;
    const totalRow = sheet.getRow(totalRowNumber);
    const totalHours = Math.round(summaries.reduce((sum, summary) => sum + summary.totalHours, 0) * 100) / 100;
    sheet.mergeCells(totalRowNumber, 1, totalRowNumber, 5);
    totalRow.getCell(1).value = `รวมทั้งหมด ${summaries.length.toLocaleString("th-TH")} คน`;
    totalRow.getCell(6).value = summaries.reduce((sum, summary) => sum + summary.days, 0);
    totalRow.getCell(7).value = summaries.reduce((sum, summary) => sum + summary.records, 0);
    totalRow.getCell(8).value = summaries.reduce((sum, summary) => sum + summary.completed, 0);
    totalRow.getCell(9).value = summaries.reduce((sum, summary) => sum + summary.open, 0);
    totalRow.getCell(10).value = totalHours;
    totalRow.getCell(10).numFmt = "0.00";
    totalRow.getCell(11).value = average(rows.map(durationHours).filter((value): value is number => value !== null));
    totalRow.getCell(11).numFmt = "0.00";
    totalRow.height = 27;
    totalRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { name: "Leelawadee UI", size: 10, bold: true, color: { argb: COLORS.white } };
      cell.fill = solidFill(COLORS.ink);
      cell.alignment = { vertical: "middle", horizontal: columnNumber === 1 ? "left" : "center" };
      cell.border = THIN_BORDER;
    });
  }

  sheet.autoFilter = {
    from: { row: EMPLOYEE_HEADER_ROW, column: 1 },
    to: { row: EMPLOYEE_HEADER_ROW, column: EMPLOYEE_COLUMN_COUNT },
  };
  sheet.headerFooter.oddFooter = "&Lข้อมูลภายในองค์กร · T TIME&Rหน้า &P / &N";
  sheet.pageSetup.printTitlesRow = `1:${EMPLOYEE_HEADER_ROW}`;
}

function setHyperlink(cell: ExcelJS.Cell, text: string, hyperlink: string, tooltip: string) {
  if (!hyperlink) {
    cell.value = "-";
    return;
  }
  cell.value = { text, hyperlink, tooltip };
  cell.font = { name: "Leelawadee UI", size: 9, underline: true, color: { argb: COLORS.blue } };
}

function addDetailsSheet(
  workbook: ExcelJS.Workbook,
  rows: AttendanceRow[],
  rangeLabel: string,
  origin: string,
) {
  const sheet = workbook.addWorksheet("รายละเอียดลงเวลา", {
    views: [{ state: "frozen", xSplit: 5, ySplit: DETAIL_HEADER_ROW, topLeftCell: "F6", activeCell: "F6", showGridLines: false }],
    properties: { defaultRowHeight: 21 },
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
      margins: { left: 0.2, right: 0.2, top: 0.55, bottom: 0.55, header: 0.2, footer: 0.2 },
    },
  });

  const widths = [7, 14, 18, 18, 25, 23, 21, 21, 14, 18, 23, 16, 17, 18, 23, 16, 17, 18];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  styleTitle(sheet, "T TIME · รายละเอียดการเข้างาน–เลิกงาน", `ช่วงรายงาน: ${rangeLabel} · ${rows.length.toLocaleString("th-TH")} รายการ`, DETAIL_COLUMN_COUNT);

  const header = sheet.getRow(DETAIL_HEADER_ROW);
  header.values = [
    "ลำดับ",
    "วันที่ทำงาน",
    "รหัสผู้ใช้",
    "ชื่อผู้ใช้",
    "ชื่อ–นามสกุล",
    "ตำแหน่ง / สิทธิ์",
    "เวลาเข้างาน",
    "เวลาเลิกงาน",
    "ชั่วโมงทำงาน",
    "สถานะ",
    "พิกัดเข้างาน",
    "แผนที่เข้างาน",
    "รูปเข้างาน",
    "ความแม่นยำเข้า (ม.)",
    "พิกัดเลิกงาน",
    "แผนที่เลิกงาน",
    "รูปเลิกงาน",
    "ความแม่นยำออก (ม.)",
  ];
  styleTableHeader(header);

  if (!rows.length) {
    sheet.mergeCells(6, 1, 6, DETAIL_COLUMN_COUNT);
    const empty = sheet.getCell(6, 1);
    empty.value = "ไม่พบข้อมูลที่ตรงกับตัวกรอง";
    empty.font = { name: "Leelawadee UI", size: 11, italic: true, color: { argb: COLORS.muted } };
    empty.alignment = { vertical: "middle", horizontal: "center" };
    empty.fill = solidFill(COLORS.paper);
    empty.border = THIN_BORDER;
    sheet.getRow(6).height = 42;
  }

  rows.forEach((attendance, index) => {
    const rowNumber = DETAIL_HEADER_ROW + 1 + index;
    const row = sheet.getRow(rowNumber);
    const role = normalizeRole(attendance.role);
    const complete = hasCheckedOut(attendance);
    const hours = durationHours(attendance);
    const checkInCoordinate = finiteCoordinate(attendance.check_in_lat, attendance.check_in_lng);
    const checkOutCoordinate = finiteCoordinate(attendance.check_out_lat, attendance.check_out_lng);

    row.getCell(1).value = index + 1;
    row.getCell(2).value = excelDateOnly(attendance.work_date) || safeText(attendance.work_date, 50);
    if (row.getCell(2).value instanceof Date) row.getCell(2).numFmt = "dd/mm/yyyy";
    row.getCell(3).value = safeText(attendance.user_id, 500);
    row.getCell(4).value = safeText(attendance.username, 500);
    row.getCell(5).value = safeText(attendance.name, 1_000);
    row.getCell(6).value = `${ROLE_LABELS[role]} (${role})`;
    row.getCell(7).value = excelBangkokDateTime(attendance.check_in_at) || "-";
    if (row.getCell(7).value instanceof Date) row.getCell(7).numFmt = "dd/mm/yyyy hh:mm";
    row.getCell(8).value = attendance.check_out_at ? (excelBangkokDateTime(attendance.check_out_at) || "ข้อมูลเวลาไม่ถูกต้อง") : "-";
    if (row.getCell(8).value instanceof Date) row.getCell(8).numFmt = "dd/mm/yyyy hh:mm";
    row.getCell(9).value = hours ?? "-";
    if (typeof row.getCell(9).value === "number") row.getCell(9).numFmt = "0.00";
    row.getCell(10).value = complete ? "ครบถ้วน" : "ยังไม่เลิกงาน";
    row.getCell(11).value = coordinateText(checkInCoordinate);
    setHyperlink(row.getCell(12), "เปิดแผนที่", mapUrl(checkInCoordinate), "เปิดตำแหน่งเข้างานบน OpenStreetMap");
    setHyperlink(row.getCell(13), "ดูรูป (ต้องเข้าสู่ระบบ)", protectedPhotoUrl(origin, attendance.check_in_file_id), "เปิดหลักฐานรูปเข้างานใน T TIME");
    row.getCell(14).value = finiteMetric(attendance.check_in_accuracy) ?? "-";
    if (typeof row.getCell(14).value === "number") row.getCell(14).numFmt = "0";
    row.getCell(15).value = coordinateText(checkOutCoordinate);
    setHyperlink(row.getCell(16), "เปิดแผนที่", mapUrl(checkOutCoordinate), "เปิดตำแหน่งเลิกงานบน OpenStreetMap");
    setHyperlink(row.getCell(17), "ดูรูป (ต้องเข้าสู่ระบบ)", protectedPhotoUrl(origin, attendance.check_out_file_id), "เปิดหลักฐานรูปเลิกงานใน T TIME");
    row.getCell(18).value = finiteMetric(attendance.check_out_accuracy) ?? "-";
    if (typeof row.getCell(18).value === "number") row.getCell(18).numFmt = "0";

    row.height = 31;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      if (!cell.font?.underline) cell.font = { name: "Leelawadee UI", size: 9, color: { argb: COLORS.ink } };
      cell.fill = solidFill(index % 2 === 0 ? COLORS.white : COLORS.paper);
      cell.alignment = {
        vertical: "middle",
        horizontal: [3, 4, 5, 6, 11, 15].includes(columnNumber) ? "left" : "center",
        wrapText: true,
      };
      cell.border = THIN_BORDER;
    });

    const statusCell = row.getCell(10);
    statusCell.font = {
      name: "Leelawadee UI",
      size: 9,
      bold: true,
      color: { argb: complete ? COLORS.green : COLORS.amber },
    };
    statusCell.fill = solidFill(complete ? "FFE7F4ED" : "FFFBefd8".toUpperCase());
  });

  sheet.autoFilter = {
    from: { row: DETAIL_HEADER_ROW, column: 1 },
    to: { row: DETAIL_HEADER_ROW, column: DETAIL_COLUMN_COUNT },
  };
  sheet.headerFooter.oddFooter = "&Lข้อมูลภายในองค์กร · ลิงก์รูปภาพต้องเข้าสู่ระบบ T TIME&Rหน้า &P / &N";
  sheet.pageSetup.printTitlesRow = `1:${DETAIL_HEADER_ROW}`;
}

function buildFileName(rows: AttendanceRow[], filters: ReportFilters) {
  const dates = rows.map((row) => safeText(row.work_date, 10)).filter(isIsoDate).sort();
  const from = filters.from || dates[0] || "all";
  const to = filters.to || dates.at(-1) || "all";
  return `T-TIME-HR-Report_${from}_to_${to}.xlsx`.replace(/[^A-Za-z0-9._-]/g, "_");
}

async function createWorkbook(rows: AttendanceRow[], filters: ReportFilters, origin: string, sourceWasCapped: boolean) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "T TIME";
  workbook.lastModifiedBy = "T TIME";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.company = "T TIME";
  workbook.title = "รายงานการเข้างาน–เลิกงาน";
  workbook.subject = "สรุปและรายละเอียดเวลาทำงานสำหรับฝ่ายบุคคล";
  workbook.description = "รายงานที่สร้างจากระบบ T TIME สำหรับผู้ดูแลระบบและฝ่ายบุคคล";
  workbook.keywords = "T TIME, attendance, HR";
  workbook.calcProperties.fullCalcOnLoad = true;

  const rangeLabel = reportDateRange(rows, filters);
  addSummarySheet(workbook, rows, filters, rangeLabel, sourceWasCapped);
  addEmployeeSheet(workbook, rows, rangeLabel);
  addDetailsSheet(workbook, rows, rangeLabel, origin);
  return workbook;
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return jsonError("unauthorized", 401);
  if (user.role !== "admin" && user.role !== "hr") return jsonError("forbidden", 403);

  const parsed = parseFilters(new URL(request.url));
  if (!parsed.filters) return jsonError(parsed.error || "invalid_filters", 400);

  try {
    const result = await callGoogleBackend<{ rows: AttendanceRow[]; today: AttendanceRow | null }>("listAttendance", {
      userId: "",
      todayUserId: user.id,
      limit: MAX_REPORT_ROWS,
    });
    const sourceRows = Array.isArray(result.rows) ? result.rows : [];
    const rows = filterRows(sourceRows, parsed.filters);
    const workbook = await createWorkbook(rows, parsed.filters, new URL(request.url).origin, sourceRows.length >= MAX_REPORT_ROWS);
    const output = await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true });
    const body = Buffer.from(output);
    const fileName = buildFileName(rows, parsed.filters);

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "report_unavailable";
    const status = ["backend_not_configured", "backend_not_initialized", "backend_unavailable", "backend_invalid_response"].includes(message) ? 503 : 502;
    return jsonError("report_unavailable", status);
  }
}
