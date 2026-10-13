/** Archive access uses existing drive.file scope; no broader Drive consent. */
function monthlyDriveRequest_(url, options) {
  const response = UrlFetchApp.fetch(url, Object.assign({}, options || {}, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true,
  }));
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    let error = {};
    try { error = JSON.parse(response.getContentText()).error || {}; } catch (ignored) { /* Non-JSON response. */ }
    const reasons = (error.errors || []).map(function (entry) { return entry.reason; }).concat(
      (error.details || []).map(function (entry) { return entry.reason; })
    ).filter(Boolean);
    let help = "";
    if (reasons.some(function (reason) { return /accessNotConfigured|SERVICE_DISABLED/i.test(reason); })) {
      help = " Enable Google Drive API in the Apps Script project's linked Google Cloud project, then rerun setupMonthlyReportingArchive.";
    } else if (reasons.some(function (reason) { return /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reason); })) {
      help = " Reauthorise the script owner for the existing drive.file permission, then rerun setupMonthlyReportingArchive.";
    }
    throw new Error("Monthly Drive request failed (HTTP " + code + "; " + (reasons.join(", ") || error.status || "unknown reason") + "): " +
      String(error.message || "Google returned no diagnostic message.").slice(0, 1500) + help);
  }
  return response;
}

function monthlyDrive_() {
  const base = "https://www.googleapis.com/drive/v3/files";
  function file(id) {
    if (!/^[A-Za-z0-9_-]+$/.test(String(id))) throw new Error("Invalid monthly archive file ID.");
    return {
      getId: function () { return id; },
      getBlob: function () { return monthlyDriveRequest_(base + "/" + id + "?alt=media").getBlob(); },
      moveTo: function (folder) {
        const metadata = JSON.parse(monthlyDriveRequest_(base + "/" + id + "?fields=parents").getContentText());
        const remove = (metadata.parents || []).join(",");
        monthlyDriveRequest_(base + "/" + id + "?addParents=" + encodeURIComponent(folder.getId()) +
          (remove ? "&removeParents=" + encodeURIComponent(remove) : ""), { method: "patch", contentType: "application/json", payload: "{}" });
      },
    };
  }
  return {
    getFileById: file,
    getFolderById: function (id) {
      if (!/^[A-Za-z0-9_-]+$/.test(String(id))) throw new Error("Invalid monthly archive folder ID.");
      return {
        getId: function () { return id; },
        getFilesByName: function (name) {
          const escaped = String(name).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
          const query = "'" + id + "' in parents and name = '" + escaped + "' and trashed = false";
          const data = JSON.parse(monthlyDriveRequest_(base + "?q=" + encodeURIComponent(query) + "&fields=files(id)&pageSize=100").getContentText());
          let index = 0;
          return { hasNext: function () { return index < data.files.length; }, next: function () { return file(data.files[index++].id); } };
        },
        createFile: function (blob) {
          const boundary = "inwardTat" + Utilities.getUuid().replace(/-/g, "");
          const metadata = { name: blob.getName(), parents: [id] };
          const prefix = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) +
            "\r\n--" + boundary + "\r\nContent-Type: " + blob.getContentType() + "\r\n\r\n";
          const bytes = Utilities.newBlob(prefix).getBytes().concat(blob.getBytes(), Utilities.newBlob("\r\n--" + boundary + "--\r\n").getBytes());
          const created = JSON.parse(monthlyDriveRequest_("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
            method: "post", contentType: "multipart/related; boundary=" + boundary, payload: bytes,
          }).getContentText());
          return file(created.id);
        },
      };
    },
  };
}

/** Run once from the Apps Script editor; does not enable or change daily triggers. */
function setupMonthlyReportingArchive() {
  // The editor can run with granular consent that omitted this manifest scope.
  // Request only the archive permission before acquiring a lock or writing data.
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, ["https://www.googleapis.com/auth/drive.file"]);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const config = getConfig_();
    const properties = PropertiesService.getScriptProperties();
    let id = String(config.MONTHLY_ARCHIVE_FOLDER_ID || properties.getProperty("MONTHLY_ARCHIVE_FOLDER_ID") || "").trim();
    if (!id) {
      const response = monthlyDriveRequest_("https://www.googleapis.com/drive/v3/files?fields=id", {
        method: "post", contentType: "application/json",
        payload: JSON.stringify({ name: "Inward TAT Monthly MIS Archive", mimeType: "application/vnd.google-apps.folder" }),
      });
      id = JSON.parse(response.getContentText()).id;
      properties.setProperty("MONTHLY_ARCHIVE_FOLDER_ID", id);
    }
    monthlyDrive_().getFolderById(id).getFilesByName("archive-access-check");
    const sheet = getSheet_(INWARD_TAT.SHEETS.CONFIG);
    const keys = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
    [["MONTHLY_ARCHIVE_FOLDER_ID", id], ["MONTHLY_WORKFLOW_ENABLED", "FALSE"]].forEach(function (setting) {
      if (keys.some(function (row) { return row[0] === setting[0]; })) {
        if (setting[0] === "MONTHLY_ARCHIVE_FOLDER_ID") updateConfigValue_(setting[0], setting[1]);
      } else sheet.appendRow([setting[0], setting[1], "TEXT", "Monthly reporting deployment setting", new Date()]);
    });
    return { ok: true, folderId: id, enabled: String(config.MONTHLY_WORKFLOW_ENABLED).toUpperCase() === "TRUE" };
  } finally { lock.releaseLock(); }
}
