/**
 * Push Notifications Inbox: translations of the messages router.js returns in
 * error / message / details. Keys are the Spanish (es-MX) texts; {placeholders}
 * are captured from the Spanish message. Callers without X-Studio-Lang (Scaler) get Spanish.
 */
const CATALOG = {
  'Coloca tu archivo "serviceAccountKey.json" en la raíz del proyecto para habilitar el guardado y el envío de notificaciones push.': {
    'en-US': 'Place your "serviceAccountKey.json" file in the project root to enable saving and sending push notifications.',
    'pt-BR': 'Coloque seu arquivo "serviceAccountKey.json" na raiz do projeto para habilitar o salvamento e o envio de notificações push.'
  },
  'serviceAccountKey.json no encontrado. Consulta README.md o la pestaña de configuración en la web.': {
    'en-US': 'serviceAccountKey.json not found. See README.md or the configuration tab on the web app.',
    'pt-BR': 'serviceAccountKey.json não encontrado. Consulte o README.md ou a aba de configuração na web.'
  },
  'Faltan parámetros requeridos: userId y token': {
    'en-US': 'Missing required parameters: userId and token',
    'pt-BR': 'Faltam parâmetros obrigatórios: userId e token'
  },
  'Firebase Admin no configurado en el servidor.': {
    'en-US': 'Firebase Admin is not configured on the server.',
    'pt-BR': 'Firebase Admin não está configurado no servidor.'
  },
  'Token FCM registrado correctamente': {
    'en-US': 'FCM token registered successfully',
    'pt-BR': 'Token FCM registrado com sucesso'
  },
  'Error al registrar token': {
    'en-US': 'Error registering token',
    'pt-BR': 'Erro ao registrar o token'
  },
  'Debe especificar el destinatario usando "userEmail" o "userId".': {
    'en-US': 'You must specify the recipient using "userEmail" or "userId".',
    'pt-BR': 'Você deve especificar o destinatário usando "userEmail" ou "userId".'
  },
  'El campo "title" es obligatorio.': {
    'en-US': 'The "title" field is required.',
    'pt-BR': 'O campo "title" é obrigatório.'
  },
  'El campo "html" es obligatorio.': {
    'en-US': 'The "html" field is required.',
    'pt-BR': 'O campo "html" é obrigatório.'
  },
  'Los campos "pushTitle" y "pushBody" son obligatorios para la notificación push.': {
    'en-US': 'The "pushTitle" and "pushBody" fields are required for the push notification.',
    'pt-BR': 'Os campos "pushTitle" e "pushBody" são obrigatórios para a notificação push.'
  },
  'Firebase Admin SDK no está configurado en el servidor.': {
    'en-US': 'Firebase Admin SDK is not configured on the server.',
    'pt-BR': 'O Firebase Admin SDK não está configurado no servidor.'
  },
  'No se encontró ningún usuario con el correo: {email}': {
    'en-US': 'No user found with the email: {email}',
    'pt-BR': 'Nenhum usuário encontrado com o e-mail: {email}'
  },
  'HTML guardado en Inbox y proceso de push completado.': {
    'en-US': 'HTML saved to the Inbox and push process completed.',
    'pt-BR': 'HTML salvo no Inbox e processo de push concluído.'
  },
  'Error interno del servidor al procesar la solicitud.': {
    'en-US': 'Internal server error while processing the request.',
    'pt-BR': 'Erro interno do servidor ao processar a solicitação.'
  },
  'El título de la notificación es obligatorio ("title" o "pushTitle").': {
    'en-US': 'The notification title is required ("title" or "pushTitle").',
    'pt-BR': 'O título da notificação é obrigatório ("title" ou "pushTitle").'
  },
  'El cuerpo de la notificación es obligatorio ("body" o "pushBody").': {
    'en-US': 'The notification body is required ("body" or "pushBody").',
    'pt-BR': 'O corpo da notificação é obrigatório ("body" ou "pushBody").'
  },
  'Notificación Push enviada con éxito.': {
    'en-US': 'Push notification sent successfully.',
    'pt-BR': 'Notificação push enviada com sucesso.'
  },
  'El usuario no tiene tokens FCM registrados en este momento.': {
    'en-US': 'The user has no FCM tokens registered at the moment.',
    'pt-BR': 'O usuário não tem tokens FCM registrados no momento.'
  },
  'Error interno del servidor al enviar la notificación push.': {
    'en-US': 'Internal server error while sending the push notification.',
    'pt-BR': 'Erro interno do servidor ao enviar a notificação push.'
  },
  'Firebase sin configurar (falta: {missing}). Configúralo en Studio Manager.': {
    'en-US': 'Firebase is not configured (missing: {missing}). Set it up in Studio Manager.',
    'pt-BR': 'Firebase não configurado (falta: {missing}). Configure-o no Studio Manager.'
  },
  'Firebase configurado': {
    'en-US': 'Firebase configured',
    'pt-BR': 'Firebase configurado'
  }
};

// status() joins the missing pieces with ', '; catalogue every combination so {missing} translates too
const MISSING_PARTS = [
  ['cuenta de servicio', 'service account', 'conta de serviço'],
  ['configuración web', 'web configuration', 'configuração web'],
  ['VAPID key', 'VAPID key', 'VAPID key']
];
for (let mask = 1; mask < 1 << MISSING_PARTS.length; mask++) {
  const parts = MISSING_PARTS.filter((p, i) => mask & (1 << i));
  CATALOG[parts.map(p => p[0]).join(', ')] = {
    'en-US': parts.map(p => p[1]).join(', '),
    'pt-BR': parts.map(p => p[2]).join(', ')
  };
}

module.exports = { CATALOG };
