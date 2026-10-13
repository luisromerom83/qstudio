const express = require('express');
const path = require('path');
const { Kafka, logLevel } = require('kafkajs');

const router = express.Router();

const DEFAULT_USER_IDS = {
  '3rd Party': process.env.DEFAULT_USER_ID_3RD_PARTY || 'quadientlatam@gmail.com',
  'Quadient Inspire DAS': process.env.DEFAULT_USER_ID_DAS || 'xbaGznvBRTbXKT0YOVEH30959486'
};

/**
 * Resuelve el broker priorizando host/puerto explícitos del formulario, luego las
 * variables KAFKA_HOST/KAFKA_PORT y KAFKA_BOOTSTRAP_SERVERS, y por último localhost:9092.
 */
function resolveBootstrapServers(host, port) {
  const h = (host || process.env.KAFKA_HOST || '').trim();
  if (h) return `${h}:${(port || process.env.KAFKA_PORT || '9092').toString().trim()}`;
  const servers = (process.env.KAFKA_BOOTSTRAP_SERVERS || '').trim();
  return servers || 'localhost:9092';
}

function str(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

/**
 * Construye el mensaje que se publica en Kafka: siempre un objeto JSON con el tipo
 * ('JSON' o 'CSV'), el contenido y los campos de integración y push en la raíz.
 * Si la entrada ya viene envuelta ({type, content, ...}) se desanida para no duplicar
 * el envoltorio, y los campos que no se informen se toman de esa entrada.
 */
function buildMessage(input) {
  const typeField = str(input.type_field) || 'type';
  const contentField = str(input.content_field) || 'content';
  const integrationField = str(input.integration_field) || 'integration';
  const dataType = (str(input.data_type) || 'json').toLowerCase();
  const raw = typeof input.content === 'string' ? input.content : JSON.stringify(input.content ?? '');

  if (!raw.trim()) throw new UserError('Es necesario adjuntar un archivo o ingresar el contenido de los datos.');

  let parsed;
  let isJson = false;
  try {
    parsed = JSON.parse(raw);
    isJson = true;
  } catch (err) {
    if (dataType === 'json') throw new UserError(`El contenido no es un JSON válido: ${err.message}`);
  }

  const wrapped = isJson && parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    && (typeField in parsed || 'type' in parsed) && (contentField in parsed || 'content' in parsed)
    ? parsed : null;
  const pick = (key, fallbackKey) => str(input[key]) || str(wrapped?.[fallbackKey || key]);

  let content;
  let type;
  if (wrapped) {
    content = wrapped[contentField] ?? wrapped.content;
    type = str(wrapped[typeField] ?? wrapped.type).toUpperCase() || 'JSON';
  } else {
    type = dataType === 'csv' || (dataType === 'auto' && !isJson) ? 'CSV' : 'JSON';
    content = type === 'JSON' ? parsed : raw;
  }

  if (type === 'CSV' && typeof content === 'string') {
    const lines = content.split(/(?<=\n)/);
    const ignoreHeader = ['true', '1', 'yes', 'on'].includes(str(input.ignore_header).toLowerCase());
    content = (ignoreHeader && lines.length > 1 ? lines.slice(1) : lines).join('');
    if (!content.trim()) throw new UserError('El contenido CSV está vacío.');
  }

  const integration = pick('integration', integrationField) || '3rd Party';
  const message = {
    [contentField]: content,
    [integrationField]: integration,
    push_content: pick('push_content'),
    push_title: pick('push_title'),
    [typeField]: type,
    user_id: pick('user_id') || DEFAULT_USER_IDS[integration] || DEFAULT_USER_IDS['3rd Party']
  };
  const useCase = pick('use_case');
  if (useCase) message.use_case = useCase;
  return message;
}

class UserError extends Error {}

async function publish(bootstrapServers, topic, message) {
  const kafka = new Kafka({
    clientId: 'use-cases-kafka-csv',
    brokers: bootstrapServers.split(',').map(s => s.trim()).filter(Boolean),
    connectionTimeout: 10000,
    requestTimeout: 30000,
    retry: { retries: 3 },
    logLevel: logLevel.WARN
  });
  const producer = kafka.producer({ allowAutoTopicCreation: true });
  await producer.connect();
  try {
    await producer.send({ topic, acks: -1, messages: [{ value: JSON.stringify(message) }] });
  } finally {
    await producer.disconnect().catch(() => {});
  }
}

router.get('/api/config', (req, res) => {
  res.json({
    kafka_host: process.env.KAFKA_HOST || '',
    kafka_port: process.env.KAFKA_PORT || '9092',
    kafka_bootstrap_servers: process.env.KAFKA_BOOTSTRAP_SERVERS || '',
    kafka_topic: process.env.KAFKA_TOPIC || 'demo-events',
    default_user_ids: DEFAULT_USER_IDS
  });
});

router.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', service: 'kafka-csv' });
});

/**
 * POST /kafka-csv/api/send
 * Body (JSON o form-urlencoded): topic, content, host?, port?, data_type?, integration?,
 * user_id?, push_title?, push_content?, use_case?, ignore_header?, *_field?
 */
router.post('/api/send', async (req, res) => {
  const body = req.body || {};
  const topic = str(body.topic) || str(process.env.KAFKA_TOPIC);
  if (!topic) return res.status(400).json({ success: false, error: 'El nombre del tópico de Kafka es obligatorio.' });

  let message;
  try {
    message = buildMessage(body);
  } catch (err) {
    return res.status(err instanceof UserError ? 400 : 500).json({ success: false, error: err.message });
  }

  const bootstrapServers = resolveBootstrapServers(str(body.host), str(body.port));
  const started = Date.now();
  try {
    await publish(bootstrapServers, topic, message);
    console.log(`[kafka-csv] Mensaje publicado en '${topic}' (${bootstrapServers}), use_case: ${message.use_case || '-'}`);
    return res.json({
      success: true,
      message: `Mensaje publicado en el tópico '${topic}'.`,
      stats: { total_sent: 1, total_errors: 0, elapsed_time: (Date.now() - started) / 1000 },
      bootstrap_servers: bootstrapServers,
      topic,
      payload: message
    });
  } catch (err) {
    console.error(`[kafka-csv] Error publicando en '${topic}' (${bootstrapServers}):`, err.message);
    return res.status(502).json({ success: false, error: `No se pudo publicar en Kafka (${bootstrapServers}): ${err.message}` });
  }
});

router.use(express.static(path.join(__dirname, 'public')));

module.exports = {
  router,
  buildMessage,
  status() {
    const servers = process.env.KAFKA_BOOTSTRAP_SERVERS || process.env.KAFKA_HOST;
    return servers
      ? { ready: true, message: `Broker: ${resolveBootstrapServers()}` }
      : { ready: false, message: 'Sin broker de Kafka en el ambiente; indica host y puerto en el formulario.' };
  }
};
