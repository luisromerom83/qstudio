/**
 * Custom demos: translations of the messages router.js returns in error / message.
 * Keys are the Spanish (es-MX) texts; {placeholders} are captured from the Spanish message.
 */
const CATALOG = {
  'Demo incompleta (falta: {missing}). Complétala en Studio Manager.': {
    'en-US': 'Incomplete demo (missing: {missing}). Complete it in Studio Manager.',
    'pt-BR': 'Demo incompleta (falta: {missing}). Complete-a no Studio Manager.'
  },
  'Quadient Cloud rechazó la solicitud del token: {detail}': {
    'en-US': 'Quadient Cloud rejected the token request: {detail}',
    'pt-BR': 'O Quadient Cloud recusou a solicitação do token: {detail}'
  },
  'Demo lista': {
    'en-US': 'Demo ready',
    'pt-BR': 'Demo pronta'
  }
};

module.exports = { CATALOG };
