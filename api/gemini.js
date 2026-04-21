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

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const prompt = [
    "Analiza esta factura electrica y devuelve SOLO un objeto JSON valido.",
    "No escribas explicaciones ni texto fuera del JSON.",
    "Extrae unicamente datos visibles. Si falta algo o no esta claro, deja cadena vacia.",
    "No inventes datos.",
    "Busca explicitamente nombre o razon social del titular, DNI/CIF/NIE, CUPS, direccion de suministro, energia consumida, importe total, precio de energia, precio de potencia, potencia contratada, tarifa, dias facturados y fechas de periodo.",
    "Extrae tambien el consumo por periodos en un objeto llamado consumo_periodos.",
    "Si la tarifa es 2.0 o similar, intenta extraer consumo en P1, P2 y P3.",
    "Si la tarifa es 3.0 o similar, extrae el consumo en todos los periodos visibles P1, P2, P3 y cualquier otro Px que aparezca.",
    "En consumo_periodos usa claves en minuscula como p1, p2, p3, p4, p5, p6.",
    "Si la imagen es borrosa, incompleta o no parece una factura electrica valida, responde igualmente en JSON dejando vacios los campos y priorizando precision.",
    "No mezcles potencia contratada con precio de potencia.",
    "No confundas el precio de la energia con el precio de potencia.",
    "No confundas dias facturados con fechas de emision o periodo de lectura.",
    "Si hay varias tablas, prioriza peajes, periodos, potencia contratada, precio potencia o precio energia.",
    "Normaliza la tarifa asi: 2.0TD para 2.0TD/2.0/similar, 3.0TD para 3.0TD/3.0/similar, vacio si no esta claro.",
    "Usa exactamente esta estructura:",
    '{"nombre_empresa":"","consumo_kwh":"","tarifa_detectada":"","importe_total":"","periodo_desde":"","periodo_hasta":"","potencia_contratada":"","precio_energia":"","precio_potencia":"","documento":"","cups":"","direccion":"","dias_factura":"","consumo_periodos":{"p1":"","p2":"","p3":"","p4":"","p5":"","p6":""}}'
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
      dias_factura: String(parsed?.dias_factura || "").trim(),
      consumo_periodos: Object.fromEntries(
        Object.entries(parsed?.consumo_periodos && typeof parsed.consumo_periodos === "object" ? parsed.consumo_periodos : {})
          .map(([key, value]) => [String(key || "").trim().toLowerCase(), String(value || "").trim()])
          .filter(([key, value]) => key && value)
      )
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
      normalized.precio_potencia,
      ...Object.values(normalized.consumo_periodos || {})
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
