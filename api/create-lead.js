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
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const body = req.body || {};
    const leadId = crypto.randomUUID();
    const invoiceFilename = String(body.invoice_filename || "factura.bin");
    const safeName = invoiceFilename.replace(/[^a-zA-Z0-9._-]/g, "-");
    const storagePath = "leads/" + leadId + "/" + safeName;
    const binary = Buffer.from(String(body.invoice_file_base64 || ""), "base64");

    const storageResponse = await fetch(
      supabaseUrl.replace(/\/$/, "") + "/storage/v1/object/invoices/" + storagePath,
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + supabaseKey,
          "apikey": supabaseKey,
          "Content-Type": body.invoice_mime_type || "application/octet-stream",
          "x-upsert": "false"
        },
        body: binary,
        signal: controller.signal
      }
    );

    if (!storageResponse.ok) {
      const message = await storageResponse.text();
      clearTimeout(timeout);
      return res.status(500).json({
        success: false,
        error: "storage_upload_failed",
        message: message || "Could not upload invoice to storage"
      });
    }

    const insertPayload = {
      id: leadId,
      nombre: body.nombre || "",
      telefono: body.telefono || "",
      importe_factura: body.importe_factura || null,
      invoice_filename: invoiceFilename,
      invoice_storage_path: storagePath,
      ocr_data: body.ocr_data || {},
      ocr_status: body.ocr_status || "failed",
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
      clearTimeout(timeout);
      return res.status(500).json({
        success: false,
        error: "database_insert_failed",
        message: message || "Could not insert lead in database"
      });
    }

    clearTimeout(timeout);
    return res.status(200).json({
      success: true,
      lead_id: leadId
    });
  } catch (error) {
    clearTimeout(timeout);
    return res.status(500).json({
      success: false,
      error: error && error.name === "AbortError" ? "timeout" : "create_lead_runtime_error",
      message: error && error.message ? error.message : "Unknown create lead error"
    });
  }
};
