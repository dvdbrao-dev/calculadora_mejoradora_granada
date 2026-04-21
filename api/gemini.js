module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      error: "method_not_allowed",
      debugInfo: "Only POST is supported"
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      success: false,
      error: "missing_gemini_api_key",
      debugInfo: "Missing GEMINI_API_KEY environment variable"
    });
  }

  const mimeType = String(req.body?.mimeType || "");
  const data = String(req.body?.data || "");

  if (!mimeType || !data) {
    return res.status(400).json({
      success: false,
      error: "invalid_payload",
      debugInfo: "mimeType and data are required"
    });
  }

  const prompt = [
    "Analiza esta factura electrica y devuelve SOLO un objeto JSON valido.",
    "No escribas explicaciones ni texto fuera del JSON.",
    "Extrae unicamente datos visibles. Si falta algo o no esta claro, deja cadena vacia.",
    "No inventes datos.",
    "Si la imagen es borrosa, incompleta o no parece una factura electrica valida, responde igualmente en JSON dejando vacios los campos y priorizando precision.",
    "No mezcles potencia contratada con precio de potencia.",
    "No confundas el precio de la energia con el precio de potencia.",
    "No confundas dias facturados con fechas de emision o periodo de lectura.",
    "Si hay varias tablas, prioriza peajes, periodos, potencia contratada, precio potencia o precio energia.",
    "Normaliza la tarifa asi: 2.0TD para 2.0TD/2.0/similar, 3.0TD para 3.0TD/3.0/similar, vacio si no esta claro.",
    "Usa exactamente esta estructura:",
    '{"nombre_empresa":"","consumo_kwh":"","tarifa_detectada":"","importe_total":"","periodo_desde":"","periodo_hasta":"","potencia_contratada":"","precio_energia":"","precio_potencia":"","documento":"","cups":"","direccion":"","dias_factura":""}'
  ].join("\n");

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data } }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const rawText = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: "gemini_http_error",
        debugInfo: rawText || ("HTTP " + response.status)
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
      const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      parsed = JSON.parse(text);
    } catch (error) {
      return res.status(200).json({
        success: false,
        error: "document_unreadable",
        debugInfo: "Gemini returned non-parseable OCR output"
      });
    }

    const normalized = {
      nombre_empresa: String(parsed?.nombre_empresa || "").trim(),
      consumo_kwh: String(parsed?.consumo_kwh || "").trim(),
      tarifa_detectada: String(parsed?.tarifa_detectada || "").trim(),
      importe_total: String(parsed?.importe_total || "").trim(),
      periodo_desde: String(parsed?.periodo_desde || "").trim(),
      periodo_hasta: String(parsed?.periodo_hasta || "").trim(),
      potencia_contratada: String(parsed?.potencia_contratada || "").trim(),
      precio_energia: String(parsed?.precio_energia || "").trim(),
      precio_potencia: String(parsed?.precio_potencia || "").trim(),
      documento: String(parsed?.documento || "").trim(),
      cups: String(parsed?.cups || "").trim(),
      direccion: String(parsed?.direccion || "").trim(),
      dias_factura: String(parsed?.dias_factura || "").trim()
    };

    const confidenceFields = [
      normalized.nombre_empresa,
      normalized.consumo_kwh,
      normalized.tarifa_detectada,
      normalized.importe_total,
      normalized.periodo_desde,
      normalized.periodo_hasta,
      normalized.potencia_contratada,
      normalized.precio_energia,
      normalized.precio_potencia
    ].filter(Boolean).length;

    if (confidenceFields === 0) {
      return res.status(200).json({
        success: false,
        error: "document_unreadable",
        debugInfo: "Image quality too low or document not a valid invoice"
      });
    }

    return res.status(200).json({
      success: true,
      data: normalized,
      error: null,
      debugInfo: confidenceFields < 4 ? "partial_ocr" : "ok"
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "ocr_runtime_error",
      debugInfo: error && error.message ? error.message : "Unknown OCR error"
    });
  }
};
