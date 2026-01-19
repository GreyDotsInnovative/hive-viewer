// API route config for Next.js

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { html, fileName } = req.body;
  if (!html) {
    res.status(400).json({ error: 'Missing html' });
    return;
  }

  try {
    const htmlToDocx = (await import('html-to-docx')).default;
    const blob = await htmlToDocx(html);
    // Ensure Buffer is available (Node.js 18+ has it global, fallback for older)
    const arrayBuffer = await blob.arrayBuffer();
    let buffer;
    if (typeof Buffer !== 'undefined') {
      buffer = Buffer.from(arrayBuffer);
    } else {
      const { Buffer: NodeBuffer } = await import('buffer');
      buffer = NodeBuffer.from(arrayBuffer);
    }
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName || 'document.docx'}"`,
    );
    res.send(buffer);
  } catch (err) {
    res
      .status(500)
      .json({ error: 'Failed to generate DOCX', details: String(err) });
  }
}
