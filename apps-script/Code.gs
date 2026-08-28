const TTN_SHEET_ID = "1SWSzPTDAmjcE8RPOLHT6oHeUVL1Lmpj7uvTFZDUU0kE";
const TTN_FOLDER_ID = "1N-gpcfG7mNp3KKWlWijiD81Ve_fVPK8a";
const TTN_TIME_ZONE = "Asia/Bangkok";
const TTN_USER_COLUMNS = 9;
const TTN_ATTENDANCE_COLUMNS = 19;
const TTN_ROLES = ["user", "admin", "hr", "employee-driver", "employee-office"];

function doGet() {
  return ttnJson_({ ok: true, service: "T TIME API" });
}

function authorizeTtn() {
  return {
    spreadsheet: SpreadsheetApp.openById(TTN_SHEET_ID).getName(),
    folder: DriveApp.getFolderById(TTN_FOLDER_ID).getName()
  };
}

function doPost(event) {
  try {
    const body = JSON.parse((event && event.postData && event.postData.contents) || "{}");
    const properties = PropertiesService.getScriptProperties();
    const savedToken = properties.getProperty("API_TOKEN");

    if (!savedToken) {
      if (body.action !== "initialize") throw new Error("backend_not_initialized");
      const token = String(body.token || "");
      if (token.length < 32 || body.sheetId !== TTN_SHEET_ID || body.folderId !== TTN_FOLDER_ID) {
        throw new Error("invalid_initialization");
      }
      properties.setProperty("API_TOKEN", token);
      return ttnJson_({ ok: true, initialized: true });
    }

    if (!ttnSafeEqual_(String(body.token || ""), savedToken)) throw new Error("unauthorized_backend");
    return ttnJson_({ ok: true, ...ttnDispatch_(String(body.action || ""), body) });
  } catch (error) {
    return ttnJson_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function ttnDispatch_(action, body) {
  switch (action) {
    case "status": return ttnStatus_();
    case "findUser": return { user: ttnFindUser_(body) };
    case "createFirstAdmin": return { user: ttnCreateFirstAdmin_(body.user || {}) };
    case "listUsers": return { users: ttnListUsers_() };
    case "createUser": return { user: ttnCreateUser_(body.user || {}) };
    case "listAttendance": return ttnListAttendance_(body);
    case "recordAttendance": return ttnRecordAttendance_(body);
    case "updateAttendance": return ttnUpdateAttendance_(body);
    case "getPhoto": return ttnGetPhoto_(body);
    default: throw new Error("invalid_action");
  }
}

function ttnJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function ttnSafeEqual_(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function ttnSpreadsheet_() {
  return SpreadsheetApp.openById(TTN_SHEET_ID);
}

function ttnSheet_(name) {
  const sheet = ttnSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error("sheet_not_found");
  return sheet;
}

function ttnRows_(sheet, columnCount) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, columnCount).getValues();
}

function ttnFirstEmptyRow_(sheet) {
  const rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  const ids = sheet.getRange(2, 1, rowCount, 1).getDisplayValues();
  const index = ids.findIndex(function (row) { return !String(row[0] || "").trim(); });
  if (index >= 0) return index + 2;
  sheet.insertRowsAfter(sheet.getMaxRows(), 100);
  return sheet.getMaxRows() - 99;
}

function ttnNormalizeRole_(value) {
  let role = String(value || "user").trim().toLowerCase().replace(/_/g, "-");
  if (role === "employee-shipping" || role === "shipping" || role === "driver") role = "employee-driver";
  if (role === "office") role = "employee-office";
  if (TTN_ROLES.indexOf(role) < 0) throw new Error("invalid_role");
  return role;
}

function ttnUserFromRow_(row, includePassword) {
  if (!String(row[0] || "").trim()) return null;
  const user = {
    id: String(row[0]),
    username: String(row[1]),
    name: String(row[4]),
    role: ttnNormalizeRole_(row[5]),
    active: row[6] === true || String(row[6]).toLowerCase() === "true",
    createdAt: ttnText_(row[7]),
    updatedAt: ttnText_(row[8])
  };
  if (includePassword) {
    user.passwordHash = String(row[2]);
    user.passwordSalt = String(row[3]);
  }
  return user;
}

function ttnText_(value) {
  if (value instanceof Date) return value.toISOString();
  return value === null || value === undefined ? "" : String(value);
}

function ttnWorkDate_(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, TTN_TIME_ZONE, "yyyy-MM-dd");
  }
  const text = ttnText_(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[1] + "-" + match[2] + "-" + match[3] : text;
}

function ttnStatus_() {
  const count = ttnRows_(ttnSheet_("Users"), TTN_USER_COLUMNS)
    .filter(function (row) { return String(row[0] || "").trim(); }).length;
  return { userCount: count };
}

function ttnFindUser_(query) {
  const id = String(query.userId || "").trim();
  const username = String(query.username || "").trim().toLowerCase();
  const rows = ttnRows_(ttnSheet_("Users"), TTN_USER_COLUMNS);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if ((id && String(row[0]) === id) || (username && String(row[1]).trim().toLowerCase() === username)) {
      return ttnUserFromRow_(row, true);
    }
  }
  return null;
}

function ttnValidateUser_(input, firstAdmin) {
  const username = String(input.username || "").trim();
  const name = String(input.name || "").trim();
  const passwordHash = String(input.passwordHash || "");
  const passwordSalt = String(input.passwordSalt || "");
  if (username.length < 3 || !/^[A-Za-z0-9._-]+$/.test(username)) throw new Error("invalid_username");
  if (name.length < 2) throw new Error("invalid_name");
  if (!/^[a-f0-9]{64}$/i.test(passwordHash) || !/^[a-f0-9]{32}$/i.test(passwordSalt)) throw new Error("invalid_password_data");
  return {
    id: String(input.id || Utilities.getUuid()),
    username: username,
    passwordHash: passwordHash,
    passwordSalt: passwordSalt,
    name: name,
    role: firstAdmin ? "admin" : ttnNormalizeRole_(input.role),
    active: true,
    createdAt: String(input.createdAt || new Date().toISOString()),
    updatedAt: String(input.updatedAt || new Date().toISOString())
  };
}

function ttnWriteUser_(sheet, rowNumber, user) {
  sheet.getRange(rowNumber, 1, 1, TTN_USER_COLUMNS).setValues([[
    user.id, user.username, user.passwordHash, user.passwordSalt, user.name,
    user.role, true, user.createdAt, user.updatedAt
  ]]);
  return {
    id: user.id, username: user.username, name: user.name, role: user.role,
    active: true, createdAt: user.createdAt, updatedAt: user.updatedAt
  };
}

function ttnCreateFirstAdmin_(input) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = ttnSheet_("Users");
    const hasUser = ttnRows_(sheet, TTN_USER_COLUMNS).some(function (row) { return String(row[0] || "").trim(); });
    if (hasUser) throw new Error("setup_already_complete");
    const user = ttnValidateUser_(input, true);
    return ttnWriteUser_(sheet, ttnFirstEmptyRow_(sheet), user);
  } finally {
    lock.releaseLock();
  }
}

function ttnListUsers_() {
  return ttnRows_(ttnSheet_("Users"), TTN_USER_COLUMNS)
    .map(function (row) { return ttnUserFromRow_(row, false); })
    .filter(Boolean)
    .sort(function (left, right) {
      if (left.active !== right.active) return left.active ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
}

function ttnCreateUser_(input) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = ttnSheet_("Users");
    const user = ttnValidateUser_(input, false);
    const duplicate = ttnRows_(sheet, TTN_USER_COLUMNS).some(function (row) {
      return String(row[0] || "").trim() && String(row[1]).trim().toLowerCase() === user.username.toLowerCase();
    });
    if (duplicate) throw new Error("username_exists");
    return ttnWriteUser_(sheet, ttnFirstEmptyRow_(sheet), user);
  } finally {
    lock.releaseLock();
  }
}

function ttnAttendanceFromRow_(row) {
  if (!String(row[0] || "").trim()) return null;
  return {
    id: String(row[0]), user_id: String(row[1]), username: String(row[2]), name: String(row[3]),
    role: ttnNormalizeRole_(row[4]), work_date: ttnWorkDate_(row[5]), check_in_at: ttnText_(row[6]),
    check_in_device_at: ttnText_(row[7]), check_in_lat: Number(row[8]), check_in_lng: Number(row[9]),
    check_in_accuracy: Number(row[10] || 0), check_in_file_id: String(row[11]),
    check_out_at: ttnText_(row[12]) || null, check_out_device_at: ttnText_(row[13]) || null,
    check_out_lat: row[14] === "" ? null : Number(row[14]), check_out_lng: row[15] === "" ? null : Number(row[15]),
    check_out_accuracy: row[16] === "" ? null : Number(row[16]), check_out_file_id: ttnText_(row[17]) || null,
    updated_at: ttnText_(row[18])
  };
}

function ttnListAttendance_(query) {
  const filterUserId = String(query.userId || "").trim();
  const todayUserId = String(query.todayUserId || filterUserId).trim();
  const todayDate = Utilities.formatDate(new Date(), TTN_TIME_ZONE, "yyyy-MM-dd");
  let rows = ttnRows_(ttnSheet_("Attendance"), TTN_ATTENDANCE_COLUMNS)
    .map(ttnAttendanceFromRow_).filter(Boolean);
  const today = rows.find(function (row) { return row.user_id === todayUserId && row.work_date === todayDate; }) || null;
  if (filterUserId) rows = rows.filter(function (row) { return row.user_id === filterUserId; });
  rows.sort(function (left, right) {
    return String(right.work_date + right.check_in_at).localeCompare(String(left.work_date + left.check_in_at));
  });
  const requestedLimit = Number(query.limit || (filterUserId ? 120 : 250));
  const limit = Math.max(1, Math.min(250, Number.isFinite(requestedLimit) ? requestedLimit : 120));
  return { rows: rows.slice(0, limit), today: today };
}

function ttnPhotoExtension_(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function ttnNumber_(value, min, max, error) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(error);
  return number;
}

function ttnRecordAttendance_(input) {
  const action = String(input.attendanceAction || "");
  if (action !== "check-in" && action !== "check-out") throw new Error("invalid_action");
  const user = ttnFindUser_({ userId: input.userId });
  if (!user || !user.active) throw new Error("account_disabled");
  const mimeType = String(input.mimeType || "");
  if (["image/jpeg", "image/png", "image/webp"].indexOf(mimeType) < 0) throw new Error("invalid_photo_type");
  const photoBase64 = String(input.photoBase64 || "");
  if (!photoBase64) throw new Error("photo_required");
  if (photoBase64.length > 12 * 1024 * 1024) throw new Error("photo_too_large");
  const lat = ttnNumber_(input.lat, -90, 90, "location_required");
  const lng = ttnNumber_(input.lng, -180, 180, "location_required");
  const accuracy = Math.max(0, Number(input.accuracy || 0));
  const now = new Date();
  const nowIso = now.toISOString();
  const workDate = Utilities.formatDate(now, TTN_TIME_ZONE, "yyyy-MM-dd");
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let file = null;
  try {
    const sheet = ttnSheet_("Attendance");
    const values = ttnRows_(sheet, TTN_ATTENDANCE_COLUMNS);
    let existingIndex = -1;
    for (let index = 0; index < values.length; index += 1) {
      if (String(values[index][0] || "").trim() && String(values[index][1]) === user.id && ttnWorkDate_(values[index][5]) === workDate) {
        existingIndex = index;
        break;
      }
    }
    if (action === "check-in" && existingIndex >= 0) throw new Error("already_checked_in");
    if (action === "check-out" && existingIndex < 0) throw new Error("check_in_first");
    if (action === "check-out" && ttnText_(values[existingIndex][12])) throw new Error("already_checked_out");

    const suffix = action === "check-in" ? "in" : "out";
    const safeUsername = user.username.replace(/[^A-Za-z0-9._-]/g, "-");
    const filename = workDate + "_" + safeUsername + "_" + suffix + "_" + now.getTime() + "." + ttnPhotoExtension_(mimeType);
    const blob = Utilities.newBlob(Utilities.base64Decode(photoBase64), mimeType, filename);
    if (blob.getBytes().length > 8 * 1024 * 1024) throw new Error("photo_too_large");
    file = DriveApp.getFolderById(TTN_FOLDER_ID).createFile(blob);

    if (action === "check-in") {
      const rowNumber = ttnFirstEmptyRow_(sheet);
      sheet.getRange(rowNumber, 1, 1, TTN_ATTENDANCE_COLUMNS).setValues([[
        Utilities.getUuid(), user.id, user.username, user.name, user.role, workDate,
        nowIso, String(input.deviceTime || ""), lat, lng, accuracy, file.getId(),
        "", "", "", "", "", "", nowIso
      ]]);
    } else {
      const rowNumber = existingIndex + 2;
      sheet.getRange(rowNumber, 13, 1, 7).setValues([[
        nowIso, String(input.deviceTime || ""), lat, lng, accuracy, file.getId(), nowIso
      ]]);
    }
    return { attendanceAction: action, workDate: workDate };
  } catch (error) {
    if (file) file.setTrashed(true);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function ttnUpdateAttendance_(input) {
  const id = String(input.id || "").trim();
  const checkInAt = new Date(String(input.checkInAt || ""));
  const hasCheckOut = Boolean(input.checkOutAt);
  const checkOutAt = hasCheckOut ? new Date(String(input.checkOutAt)) : null;
  if (!id || Number.isNaN(checkInAt.getTime()) || (checkOutAt && Number.isNaN(checkOutAt.getTime()))) {
    throw new Error("invalid_datetime");
  }
  if (checkOutAt && checkOutAt.getTime() < checkInAt.getTime()) throw new Error("check_out_before_check_in");

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = ttnSheet_("Attendance");
    const rows = ttnRows_(sheet, TTN_ATTENDANCE_COLUMNS);
    const index = rows.findIndex(function (row) { return String(row[0]) === id; });
    if (index < 0) throw new Error("attendance_not_found");
    const userId = String(rows[index][1]);
    const workDate = Utilities.formatDate(checkInAt, TTN_TIME_ZONE, "yyyy-MM-dd");
    const duplicate = rows.some(function (row, rowIndex) {
      return rowIndex !== index && String(row[0] || "").trim() && String(row[1]) === userId && ttnWorkDate_(row[5]) === workDate;
    });
    if (duplicate) throw new Error("duplicate_work_date");

    const rowNumber = index + 2;
    sheet.getRange(rowNumber, 6, 1, 2).setValues([[workDate, checkInAt.toISOString()]]);
    if (hasCheckOut) sheet.getRange(rowNumber, 13).setValue(checkOutAt.toISOString());
    sheet.getRange(rowNumber, 19).setValue(new Date().toISOString());
    return { id: id, workDate: workDate };
  } finally {
    lock.releaseLock();
  }
}

function ttnGetPhoto_(query) {
  const fileId = String(query.fileId || "").trim();
  if (!fileId) throw new Error("invalid_photo_key");
  const rows = ttnRows_(ttnSheet_("Attendance"), TTN_ATTENDANCE_COLUMNS);
  let ownerUserId = "";
  for (let index = 0; index < rows.length; index += 1) {
    if (String(rows[index][11]) === fileId || String(rows[index][17]) === fileId) {
      ownerUserId = String(rows[index][1]);
      break;
    }
  }
  if (!ownerUserId) throw new Error("photo_not_found");
  const file = DriveApp.getFileById(fileId);
  let inTargetFolder = false;
  const parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === TTN_FOLDER_ID) inTargetFolder = true;
  }
  if (!inTargetFolder) throw new Error("photo_not_found");
  const blob = file.getBlob();
  return {
    ownerUserId: ownerUserId,
    mimeType: blob.getContentType() || "image/jpeg",
    base64: Utilities.base64Encode(blob.getBytes())
  };
}
