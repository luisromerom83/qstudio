/**
 * Server messages of the kafka-csv case in en-US / pt-BR (Spanish is the source text).
 * Loaded by server.js and applied by shared/i18n-server.js.
 */
const CATALOG = {
  'El nombre del tópico de Kafka es obligatorio.': {
    'en-US': 'The Kafka topic name is required.',
    'pt-BR': 'O nome do tópico do Kafka é obrigatório.'
  },
  'Es necesario adjuntar un archivo o ingresar el contenido de los datos.': {
    'en-US': 'Attach a file or enter the data content.',
    'pt-BR': 'É necessário anexar um arquivo ou informar o conteúdo dos dados.'
  },
  'El contenido no es un JSON válido: {detail}': {
    'en-US': 'The content is not valid JSON: {detail}',
    'pt-BR': 'O conteúdo não é um JSON válido: {detail}'
  },
  'El contenido CSV está vacío.': {
    'en-US': 'The CSV content is empty.',
    'pt-BR': 'O conteúdo CSV está vazio.'
  },
  "Mensaje publicado en el tópico '{topic}'.": {
    'en-US': "Message published to topic '{topic}'.",
    'pt-BR': "Mensagem publicada no tópico '{topic}'."
  },
  'No se pudo publicar en Kafka ({servers}): {detail}': {
    'en-US': 'Could not publish to Kafka ({servers}): {detail}',
    'pt-BR': 'Não foi possível publicar no Kafka ({servers}): {detail}'
  },
  'Sin broker de Kafka en el ambiente; indica host y puerto en el formulario.': {
    'en-US': 'No Kafka broker in this environment; enter the host and port in the form.',
    'pt-BR': 'Não há broker do Kafka no ambiente; informe o host e a porta no formulário.'
  }
};

module.exports = { CATALOG };
