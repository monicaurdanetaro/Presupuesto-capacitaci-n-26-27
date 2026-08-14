// scripts/send-reminders.js
// Envía recordatorios personalizados a quienes tengan facturas pendientes
// por cargar en el Drive de CxP (cargadoCxP === false y NO están ya en el panel oficial).
// Si TEST_EMAIL está definido, todos los correos se redirigen ahí (modo prueba).

const nodemailer = require('nodemailer');

const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL;
const SMTP_EMAIL = process.env.SMTP_EMAIL;
const SMTP_APP_PASSWORD = process.env.SMTP_APP_PASSWORD;
const REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL || SMTP_EMAIL;
const TEST_EMAIL = (process.env.TEST_EMAIL || '').trim();

// Mapeo de iniciales (campo "cargadoPor") a correo real
const EMAILS = {
  OO: 'oriana.ornelas@farmatodo.com',
  AH: 'andreina.herrera@farmatodo.com',
  YP: 'yannaly.perez@farmatodo.com',
  ADA: 'adriana.dangelo@farmatodo.com',
  MU: 'monica.urdanetaro@farmatodo.com',
  VP: 'verona.pecchio@farmatodo.com',
  CG: 'claudia.garcia@farmatodo.com',
  OG: 'oreana.gonzalez@farmatodo.com'
};

function nombreDesdeCorreo(correo) {
  const local = correo.split('@')[0];
  return local
    .split('.')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function fmtUSD(n) {
  const v = Number(n) || 0;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function estadoTramite(x) {
  if (!x.aprobado) return 'Esperando aprobación';
  if (!x.ordenCompra) return 'Esperando orden de compra';
  return 'Por cargar en CxP y Drive';
}

async function obtenerGastos() {
  const url = `${FIREBASE_DB_URL}/ftdcap/expenses.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('No se pudo leer Firebase: ' + res.status);
  const data = await res.json();
  if (!data) return [];
  return Array.isArray(data) ? data.filter(Boolean) : Object.values(data).filter(Boolean);
}

function agruparPendientesPorResponsable(gastos) {
  const grupos = {};
  gastos
    .filter(x => x && !x.manual && !x.cargadoCxP && !x.enPanel)
    .forEach(x => {
      const resp = x.cargadoPor;
      if (!resp) return;
      if (!grupos[resp]) grupos[resp] = [];
      grupos[resp].push(x);
    });
  return grupos;
}

function construirHTML(nombre, items) {
  const filas = items
    .map(
      x => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee;">${x.solicitud || ''}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${x.proveedor || ''}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${x.numeroFactura || '—'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${x.concepto || ''}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${fmtUSD(x.monto)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${estadoTramite(x)}</td>
      </tr>`
    )
    .join('');

  const total = items.reduce((s, x) => s + (Number(x.monto) || 0), 0);

  return `
  <div style="font-family:Arial,sans-serif;color:#12294f;max-width:680px;">
    <h2 style="color:#0c1d3d;">Recordatorio: facturas pendientes por cargar en el Drive de CxP</h2>
    <p>Hola ${nombre},</p>
    <p>Tienes <b>${items.length}</b> factura(s) que todavía no están marcadas como cargadas en el Excel de Cuentas por Pagar / Drive, por un total de <b>${fmtUSD(total)}</b>.</p>
    <p>Recuerda que el día máximo de la semana para cargarlas es <b>hoy miércoles</b>.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:14px;">
      <tr style="background:#eaf1ff;">
        <th style="padding:8px;text-align:left;">Solicitud</th>
        <th style="padding:8px;text-align:left;">Proveedor</th>
        <th style="padding:8px;text-align:left;">Nº Factura</th>
        <th style="padding:8px;text-align:left;">Concepto</th>
        <th style="padding:8px;text-align:right;">Monto</th>
        <th style="padding:8px;text-align:left;">Estado</th>
      </tr>
      ${filas}
    </table>
    <p style="margin-top:18px;font-size:12px;color:#7c8aa0;">
      Este correo se generó automáticamente desde la Plataforma de Presupuesto de Capacitación.
      Si ya cargaste alguna de estas facturas, marca el check correspondiente en la pestaña "Seguimiento" para que deje de aparecer aquí.
    </p>
  </div>`;
}

async function main() {
  if (!FIREBASE_DB_URL || !SMTP_EMAIL || !SMTP_APP_PASSWORD) {
    throw new Error('Faltan variables de entorno (FIREBASE_DB_URL, SMTP_EMAIL o SMTP_APP_PASSWORD).');
  }

  const gastos = await obtenerGastos();
  const grupos = agruparPendientesPorResponsable(gastos);
  const responsablesConPendientes = Object.keys(grupos);

  if (responsablesConPendientes.length === 0) {
    console.log('Nadie tiene facturas pendientes hoy. No se envía ningún correo.');
    return;
  }

  if (TEST_EMAIL) {
    console.log(`⚠ MODO PRUEBA activo: todos los correos se enviarán a ${TEST_EMAIL} en vez de a cada persona real.`);
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: SMTP_EMAIL, pass: SMTP_APP_PASSWORD }
  });

  for (const iniciales of responsablesConPendientes) {
    const correoReal = EMAILS[iniciales];
    if (!correoReal) {
      console.warn(`No hay correo mapeado para las iniciales "${iniciales}", se omite.`);
      continue;
    }
    const items = grupos[iniciales];
    const nombre = nombreDesdeCorreo(correoReal);
    const html = construirHTML(nombre, items);
    const destinatarioFinal = TEST_EMAIL || correoReal;
    const asunto = TEST_EMAIL
      ? `[PRUEBA - originalmente para ${nombre}] ${items.length} factura(s) pendiente(s) por cargar en Drive de CxP`
      : `Recordatorio: ${items.length} factura(s) pendiente(s) por cargar en Drive de CxP`;

    try {
      await transporter.sendMail({
        from: `"Equipo de Capacitación" <${SMTP_EMAIL}>`,
        replyTo: REPLY_TO_EMAIL,
        to: destinatarioFinal,
        subject: asunto,
        html
      });
      console.log(`✓ Enviado a ${destinatarioFinal} (originalmente ${correoReal}, ${items.length} pendientes)`);
    } catch (err) {
      console.error(`✗ Error enviando a ${destinatarioFinal}:`, err.message);
    }
  }
}

main().catch(err => {
  console.error('Error general:', err);
  process.exit(1);
});
