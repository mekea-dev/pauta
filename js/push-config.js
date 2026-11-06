// Onde fica o serviço de lembretes (um Cloudflare Worker grátis; o passo a passo está em docs/LEMBRETES.md).
// Vazio = o app não oferece avisos com o app fechado (os avisos com o app aberto continuam funcionando).
// Se mudar o endereço, ajuste também o "connect-src" da política de conteúdo em index.html (há um teste que confere).
export const PUSH = {
  workerUrl: 'https://pauta-lembretes.leonardomaquea96.workers.dev',
};
