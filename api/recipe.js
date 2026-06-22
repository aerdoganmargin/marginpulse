// MarginPulse — AI Reçete Önerisi (serverless function)
// Bu dosya Vercel'de sunucu tarafında çalışır. API key burada güvende, tarayıcıya inmez.

export default async function handler(req, res) {
  // Sadece POST kabul et
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { productName, category, portionSize, portionUnit } = req.body || {};

  if (!productName || productName.trim().length === 0) {
    return res.status(400).json({ error: 'Ürün adı gerekli' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key yapılandırılmamış' });
  }

  // Porsiyon bilgisi (kullanıcı girmişse)
  const sizeNum = Number(portionSize);
  const hasPortion = sizeNum > 0;
  let portionLine;

  if (hasPortion && portionUnit === 'adet') {
    portionLine = `ÇOK ÖNEMLİ — PORSİYON: Bu üründe 1 porsiyon = ${sizeNum} ADET "${productName}" demektir. Yani tabakta ${sizeNum} tane "${productName}" var. Malzeme miktarlarını TAM ${sizeNum} adet için hesapla.
Örnek mantık: 1 adet için 50g kıyma gerekiyorsa, ${sizeNum} adet için ${sizeNum} × 50 = ${sizeNum*50}g kıyma yazmalısın. Tüm malzemeleri bu şekilde ${sizeNum} ile çarp.`;
  } else if (hasPortion) {
    portionLine = `ÇOK ÖNEMLİ — PORSİYON: Bu üründe 1 porsiyon = ${sizeNum} ${portionUnit} demektir. Yani bir tabak servis ${sizeNum} ${portionUnit} ağırlığında/hacmindedir. Tüm malzemelerin toplamı yaklaşık ${sizeNum} ${portionUnit} olacak şekilde reçeteyi hesapla.`;
  } else {
    portionLine = `PORSİYON: Kullanıcı porsiyon boyutu belirtmedi. Bu yemek için en tipik 1 porsiyonu sen varsay.`;
  }

  // Claude'a göndereceğimiz talimat
  const prompt = `Sen bir restoran maliyet uzmanısın. Aşağıdaki yemek için reçete oluştur.

Yemek: "${productName}"${category ? ` (Kategori: ${category})` : ''}

${portionLine}

Cevabını şu JSON formatında ver:
{
  "assumption": "Reçeteyi tam olarak hangi porsiyon/miktar için hesapladığını tek cümleyle açıkla (örn: '3 adet içli köfte için hesaplandı')",
  "ingredients": [
    {"name":"malzeme adı (Türkçe, kısa)","qty":miktar (sayı),"unit":"g/ml/adet","price":tahmini birim fiyat}
  ]
}

Malzeme miktarı (qty) kuralı: yukarıda belirtilen porsiyon büyüklüğünün TAMAMI için toplam miktar olmalı. Porsiyon kaç adetse o kadar adedin toplam malzemesini ver.

Fiyat (price) kuralı: g/ml için €/kg veya €/lt cinsinden, adet için €/adet cinsinden. Avrupa/Hollanda 2025 piyasasına göre yaklaşık.

ÖNEMLİ:
- Sadece geçerli JSON döndür, başka hiçbir şey yazma (markdown, backtick YOK).
- 4-8 ana malzeme yeterli.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API hatası:', errText);
      return res.status(502).json({ error: 'AI servisi yanıt vermedi' });
    }

    const data = await response.json();
    let text = (data.content || [])
      .map(b => b.type === 'text' ? b.text : '')
      .join('')
      .trim();

    // Olası markdown backtick temizliği
    text = text.replace(/```json/gi, '').replace(/```/g, '').trim();

    // JSON parse et
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // Bazen metin içinde JSON objesini bul
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('JSON parse edilemedi');
      }
    }

    // ingredients dizisi + assumption notu
    let ingredients = parsed.ingredients;
    const assumption = typeof parsed.assumption === 'string' ? parsed.assumption : '';

    if (!Array.isArray(ingredients)) throw new Error('Geçersiz format');
    ingredients = ingredients
      .filter(r => r && r.name)
      .map(r => ({
        name: String(r.name).slice(0, 60),
        qty: Number(r.qty) || 0,
        unit: ['g','ml','adet'].includes(r.unit) ? r.unit : 'g',
        price: Number(r.price) || 0
      }));

    return res.status(200).json({ recipe: ingredients, assumption });

  } catch (err) {
    console.error('Reçete üretim hatası:', err);
    return res.status(500).json({ error: 'Reçete oluşturulamadı, lütfen tekrar dene' });
  }
}
