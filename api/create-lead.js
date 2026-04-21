const { randomUUID } = require("crypto");

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png"
]);
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function cleanString(value) {
  return String(value || "").trim();
}

function parseInvoiceAmount(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = String(value).replace(",", ".").trim();
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function isValidBase64(value) {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, error: "method_not_allowed", message: "Only POST is supported" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      success: false,
      error: "missing_supabase_env",
      message: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const body = req.body || {};
    const nombre = cleanString(body.nombre);
    const telefono = cleanString(body.telefono);
    const invoiceBase64 = cleanString(body.invoice_file_base64);
    const invoiceMimeType = cleanString(body.invoice_mime_type).toLowerCase();
    const invoiceFilename = cleanString(body.invoice_filename) || "factura.bin";
    const importeFactura = parseInvoiceAmount(body.importe_factura);

    if (!nombre || !telefono || !invoiceBase64) {
      return res.status(400).json({
        success: false,
        error: "invalid_payload",
        message: "nombre, telefono and invoice_file_base64 are required"
      });
    }

    if (!ALLOWED_MIME_TYPES.has(invoiceMimeType)) {
      return res.status(400).json({
        success: false,
        error: "invalid_mime_type",
        message: "Only PDF, JPG and PNG files are supported"
      });
    }

    if (!isValidBase64(invoiceBase64)) {
      return res.status(400).json({
        success: false,
        error: "invalid_invoice_encoding",
        message: "invoice_file_base64 must be valid base64"
      });
    }

    const binary = Buffer.from(invoiceBase64, "base64");
    if (!binary.length) {
      return res.status(400).json({
        success: false,
        error: "empty_invoice",
        message: "Invoice file is empty"
      });
    }

    if (binary.length > MAX_FILE_BYTES) {
      return res.status(413).json({
        success: false,
        error: "invoice_too_large",
        message: "Invoice exceeds the 10 MB limit"
      });
    }

    const leadId = randomUUID();
    const safeName = invoiceFilename.replace(/[^a-zA-Z0-9._-]/g, "-");
    const storagePath = "leads/" + leadId + "/" + safeName;

    const storageResponse = await fetch(
      supabaseUrl.replace(/\/$/, "") + "/storage/v1/object/invoices/" + storagePath,
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + supabaseKey,
          "apikey": supabaseKey,
          "Content-Type": invoiceMimeType,
          "x-upsert": "false"
        },
        body: binary,
        signal: controller.signal
      }
    );

    if (!storageResponse.ok) {
      const message = await storageResponse.text();
      return res.status(500).json({
        success: false,
        error: "storage_upload_failed",
        message: message || "Could not upload invoice to storage"
      });
    }

    const insertPayload = {
      id: leadId,
      nombre,
      telefono,
      importe_factura: importeFactura,
      invoice_filename: invoiceFilename,
      invoice_storage_path: storagePath,
      ocr_data: body.ocr_data && typeof body.ocr_data === "object" ? body.ocr_data : {},
      ocr_status: cleanString(body.ocr_status) || "failed",
      stage: "form_confirmed",
      created_at: new Date().toISOString()
    };

    const dbResponse = await fetch(
      supabaseUrl.replace(/\/$/, "") + "/rest/v1/leads",
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + supabaseKey,
          "apikey": supabaseKey,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify(insertPayload),
        signal: controller.signal
      }
    );

    if (!dbResponse.ok) {
      const message = await dbResponse.text();
      return res.status(500).json({
        success: false,
        error: "database_insert_failed",
        message: message || "Could not insert lead in database"
      });
    }

    return res.status(200).json({
      success: true,
      lead_id: leadId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error && error.name === "AbortError" ? "timeout" : "create_lead_runtime_error",
      message: error && error.message ? error.message : "Unknown create lead error"
    });
  } finally {
    clearTimeout(timeout);
  }
};
