/**
 * Digital Advantage Inbox: translations of the messages router.js returns in error / message.
 * Keys are the Spanish (es-MX) texts; {placeholders} are captured from the Spanish message.
 */
const CATALOG = {
  'Quadient Cloud sin configurar (falta: {missing}). Configúralo en Studio Manager.': {
    'en-US': 'Quadient Cloud is not configured (missing: {missing}). Set it up in Studio Manager.',
    'pt-BR': 'Quadient Cloud não configurado (falta: {missing}). Configure-o no Studio Manager.'
  },
  'Quadient Cloud configurado': {
    'en-US': 'Quadient Cloud configured',
    'pt-BR': 'Quadient Cloud configurado'
  },
  'Usuario o contraseña incorrectos': {
    'en-US': 'Wrong username or password',
    'pt-BR': 'Usuário ou senha incorretos'
  },
  'No has iniciado sesión': {
    'en-US': 'You are not signed in',
    'pt-BR': 'Você não está conectado'
  },
  'La aplicación de Quadient Cloud no tiene usuarios con contraseña: asígnale un almacén de usuarios con Inspire Authentication': {
    'en-US': 'The Quadient Cloud application has no password users: assign it a user store with Inspire Authentication',
    'pt-BR': 'A aplicação do Quadient Cloud não tem usuários com senha: atribua a ela um repositório de usuários com Inspire Authentication'
  },
  'Quadient Cloud rechazó el inicio de sesión: {detail}': {
    'en-US': 'Quadient Cloud rejected the sign-in: {detail}',
    'pt-BR': 'O Quadient Cloud recusou o login: {detail}'
  },
  'Esta aplicación de Quadient Cloud no permite crear cuentas: necesita un almacén de usuarios con autorregistro': {
    'en-US': "This Quadient Cloud application doesn't allow creating accounts: it needs a user store with self-registration",
    'pt-BR': 'Esta aplicação do Quadient Cloud não permite criar contas: precisa de um repositório de usuários com autorregistro'
  },
  'Usuario, correo y contraseña son obligatorios': {
    'en-US': 'Username, email and password are required',
    'pt-BR': 'Usuário, e-mail e senha são obrigatórios'
  },
  'Quadient Cloud no creó la cuenta: {detail}': {
    'en-US': "Quadient Cloud didn't create the account: {detail}",
    'pt-BR': 'O Quadient Cloud não criou a conta: {detail}'
  },
  'Cuenta creada. Revisa tu correo para activarla y después inicia sesión.': {
    'en-US': 'Account created. Check your email to activate it and then sign in.',
    'pt-BR': 'Conta criada. Verifique seu e-mail para ativá-la e depois entre.'
  },
  'Tu sesión de Quadient Cloud expiró; vuelve a iniciar sesión': {
    'en-US': 'Your Quadient Cloud session expired; sign in again',
    'pt-BR': 'Sua sessão do Quadient Cloud expirou; entre novamente'
  }
};

module.exports = { CATALOG };
