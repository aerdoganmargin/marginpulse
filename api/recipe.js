// MarginPulse — AI Reçete Önerisi (serverless function)
// Bu dosya Vercel'de sunucu tarafında çalışır. API key burada güvende, tarayıcıya inmez.

export default async function handler(req, res) {
  // Sadece POST kabul et
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { productName, category } = req.body || {};

  if (!productName || productName.trim().length === 0) {
    return res.status(400).json({ error: 'Ürün adı gerekli' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key yapılandırılmamış' });
  }

  // Claude'a göndereceğimiz talimat
  const prompt = `Sen bir restoran maliyet uzmanısın. Aşağıdaki yemek için 1 porsiyonluk tipik bir reçete oluştur.

Yemek: "${productName}"${category ? ` (Kategori: ${category})` : ''}

Her malzeme için:
- name: malzeme adı (Türkçe, kısa)
- qty: 1 porsiyon için miktar (sayı)
- unit: "g", "ml" veya "adet"
- price: bu malzemenin Avrupa/Hollanda piyasasında tahmini birim fiyatı — g/ml için €/kg veya €/lt cinsinden, adet için €/adet cinsinden (sayı, ondalık nokta ile)

ÖNEMLİ:
- Sadece geçerli JSON dizisi döndür, başka hiçbir şey yazma (markdown, açıklama, backtick YOK).
- 4-8 ana malzeme yeterli.
- Fiyatlar Avrupa/Hollanda 2025 piyasasına göre yaklaşık olsun.

Örnek format:
[{"name":"Dana kıyma","qty":180,"unit":"g","price":12.5},{"name":"Tuz","qty":3,"unit":"g","price":0.8}]`;

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
    let recipe;
    try {
      recipe = JSON.parse(text);
    } catch (e) {
      // Bazen metin içinde JSON dizisini bul
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        recipe = JSON.parse(match[0]);
      } else {
        throw new Error('JSON parse edilemedi');
      }
    }

    // Doğrulama: dizi mi ve beklenen alanlar var mı
    if (!Array.isArray(recipe)) throw new Error('Geçersiz format');
    recipe = recipe
      .filter(r => r && r.name)
      .map(r => ({
        name: String(r.name).slice(0, 60),
        qty: Number(r.qty) || 0,
        unit: ['g','ml','adet'].includes(r.unit) ? r.unit : 'g',
        price: Number(r.price) || 0
      }));

    return res.status(200).json({ recipe });

  } catch (err) {
    console.error('Reçete üretim hatası:', err);
    return res.status(500).json({ error: 'Reçete oluşturulamadı, lütfen tekrar dene' });
  }
}
