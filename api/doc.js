const { readFileSync } = require('fs');
const { join } = require('path');

module.exports = async function handler(req, res) {
  const { id } = req.query;

  let title = "B2P International - Document Portal";
  let description = "View and download your digital invoices, quotations, and work orders.";
  let logoUrl = "https://b2pinternational.com/billing/logo_b2p_international.png?v=5";

  try {
    const supabaseUrl = "https://rqovkmjsdwzggebvwvdk.supabase.co";
    const apiKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxb3ZrbWpzZHd6Z2dlYnZ3dmRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNDQ0MzMsImV4cCI6MjA5ODcyMDQzM30.A_4pG8rG4KDTxa85DSjJ1Y6wGwqMwXPL9DrlzoYjZ9M";
    
    // Fetch document to get company_id
    const docRes = await fetch(`${supabaseUrl}/rest/v1/documents?id=eq.${id}&select=company_id,document_number,document_type,customer_name`, {
      headers: {
        "apikey": apiKey,
        "Authorization": `Bearer ${apiKey}`
      }
    });
    
    if (docRes.ok) {
      const docs = await docRes.json();
      if (docs && docs.length > 0) {
        const doc = docs[0];
        const companyId = doc.company_id;
        
        // Fetch company profile to get logo
        const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${companyId}&select=name`, {
          headers: {
            "apikey": apiKey,
            "Authorization": `Bearer ${apiKey}`
          }
        });
        
        if (profileRes.ok) {
          const profiles = await profileRes.json();
          if (profiles && profiles.length > 0) {
            const profile = profiles[0];
            const isIntermedia = profile.name.toLowerCase().includes('inter') || profile.name.toLowerCase().includes('media');
            
            title = isIntermedia 
              ? "B2P Inter-Media Solutions - Document Portal"
              : "B2P International - Document Portal";
              
            description = `View and download document #${doc.document_number} for ${doc.customer_name}.`;
            
            logoUrl = isIntermedia 
              ? "https://b2pinternational.com/billing/logo_b2p_intermedia.png?v=5" 
              : "https://b2pinternational.com/billing/logo_b2p_international.png?v=5";
          }
        }
      }
    }
  } catch (err) {
    console.error("Error fetching OG meta:", err);
  }

  try {
    // Read build output file
    const htmlPath = join(process.cwd(), 'dist', 'billing', 'index.html');
    let html = readFileSync(htmlPath, 'utf8');

    // Replace OG metadata tags
    html = html.replace(/<title>[^<]*<\/title>/g, `<title>${title}</title>`);
    html = html.replace(/<meta property="og:title" content="[^"]*" \/>/g, `<meta property="og:title" content="${title}" />`);
    html = html.replace(/<meta property="og:description" content="[^"]*" \/>/g, `<meta property="og:description" content="${description}" />`);
    html = html.replace(/<meta property="og:image" content="[^"]*" \/>/g, `<meta property="og:image" content="${logoUrl}" />`);
    html = html.replace(/<meta name="description" content="[^"]*" \/>/g, `<meta name="description" content="${description}" />`);

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  } catch (err) {
    res.status(500).send("Internal Server Error: " + String(err));
  }
};
