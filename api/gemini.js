function extractStructuredJson(rawText) {
  const raw = String(rawText || "").trim();
  if (!raw) {
    throw new Error("empty_response");
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw error;
  }
}

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png"
]);
const MAX_INLINE_DATA_BYTES = 8 * 1024 * 1024;

function estimateBase64Bytes(base64Value) {
  const value = String(base64Value || "");
  const padding = (value.match(/=*$/) || [""])[0].length;
  return Math.floor((value.length * 3) / 4) - padding;
}

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

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return res.status(400).json({
      success: false,
      error: "invalid_mime_type",
      debugInfo: "Only PDF, JPG and PNG are supported"
    });
  }

  if (estimateBase64Bytes(data) > MAX_INLINE_DATA_BYTES) {
    return res.status(413).json({
      success: false,
      error: "document_too_large",
      debugInfo: "Document exceeds the OCR size limit"
    });
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const prompt = [
    "Analiza esta factura electrica y devuelve SOLO un objeto JSON valido.",
    "No escribas explicaciones ni texto fuera del JSON.",
    "Extrae unicamente datos visibles. Si falta algo o no esta claro, deja cadena vacia.",
    "No inventes datos.",
    "Busca explicitamente la comercializadora, nombre o razon social del titular, DNI/CIF/NIE, CUPS, direccion de suministro, energia consumida, importe total, precio de energia, precios de energia por periodo, potencia contratada por periodo, potencia total, tarifa, dias facturados y fechas de periodo.",
    "Si aparecen varios periodos, extrae P1, P2 y P3 cuando esten visibles.",
    "No mezcles potencia contratada con precio de potencia.",
    "No confundas el precio de la energia con el precio de potencia.",
    "No confundas dias facturados con fechas de emision o periodo de lectura.",
    "Si hay varias tablas, prioriza peajes, periodos, potencia contratada, precio potencia o precio energia.",
    "Normaliza la tarifa asi: 2.0TD para 2.0TD/2.0/similar, 3.0TD para 3.0TD/3.0/similar, vacio si no esta claro.",
    "Si la imagen es borrosa, incompleta o no parece una factura electrica valida, responde igualmente en JSON dejando vacios los campos y priorizando precision.",
    "Usa exactamente esta estructura:",
    '{"comercializadora":"","nombre_empresa":"","documento":"","cups":"","direccion":"","tarifa_detectada":"","consumo_kwh":"","importe_total":"","precio_energia":"","precio_energia_p1":"","precio_energia_p2":"","precio_energia_p3":"","potencia_contratada_p1":"","potencia_contratada_p2":"","potencia_contratada_p3":"","potencia":"","dias_factura":"","periodo_desde":"","periodo_hasta":""}'
  ].join("\n");

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(apiKey),
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
            topP: 0.1,
            topK: 1,
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
      const envelope = extractStructuredJson(rawText);
      const text = envelope?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      parsed = extractStructuredJson(text);
    } catch (error) {
      return res.status(200).json({
        success: false,
        error: "document_unreadable",
        debugInfo: "Gemini returned non-parseable OCR output"
      });
    }

    const normalized = {
      comercializadora: String(parsed?.comercializadora || "").trim(),
      nombre_empresa: String(parsed?.nombre_empresa || "").trim(),
      documento: String(parsed?.documento || "").trim(),
      cups: String(parsed?.cups || "").trim(),
      direccion: String(parsed?.direccion || "").trim(),
      tarifa_detectada: String(parsed?.tarifa_detectada || "").trim(),
      consumo_kwh: String(parsed?.consumo_kwh || "").trim(),
      importe_total: String(parsed?.importe_total || "").trim(),
      precio_energia: String(parsed?.precio_energia || "").trim(),
      precio_energia_p1: String(parsed?.precio_energia_p1 || "").trim(),
      precio_energia_p2: String(parsed?.precio_energia_p2 || "").trim(),
      precio_energia_p3: String(parsed?.precio_energia_p3 || "").trim(),
      potencia_contratada_p1: String(parsed?.potencia_contratada_p1 || "").trim(),
      potencia_contratada_p2: String(parsed?.potencia_contratada_p2 || "").trim(),
      potencia_contratada_p3: String(parsed?.potencia_contratada_p3 || "").trim(),
      potencia: String(parsed?.potencia || "").trim(),
      dias_factura: String(parsed?.dias_factura || "").trim(),
      periodo_desde: String(parsed?.periodo_desde || "").trim(),
      periodo_hasta: String(parsed?.periodo_hasta || "").trim(),
    };

    const confidenceFields = [
      normalized.comercializadora,
      normalized.nombre_empresa,
      normalized.documento,
      normalized.cups,
      normalized.direccion,
      normalized.tarifa_detectada,
      normalized.consumo_kwh,
      normalized.importe_total,
      normalized.precio_energia,
      normalized.precio_energia_p1,
      normalized.precio_energia_p2,
      normalized.precio_energia_p3,
      normalized.potencia_contratada_p1,
      normalized.potencia_contratada_p2,
      normalized.potencia_contratada_p3,
      normalized.potencia,
      normalized.dias_factura,
      normalized.periodo_desde,
      normalized.periodo_hasta,
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
