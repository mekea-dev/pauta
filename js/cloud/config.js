// Conta na nuvem (opcional): login e sincronização entre aparelhos, usando o Firebase (plano gratuito).
// Enquanto apiKey e databaseUrl estiverem vazios, NADA disso aparece no app e ele funciona só neste aparelho.
// Passo a passo para preencher: docs/NUVEM.md
export const CLOUD = {
  // "Chave de API da Web" do seu projeto Firebase (Configurações do projeto > Geral > Seus apps).
  // Não é segredo: quem protege os dados são as regras do banco (veja docs/NUVEM.md).
  apiKey: '',

  // Endereço do Realtime Database, ex.: https://meu-projeto-default-rtdb.firebaseio.com
  databaseUrl: '',

  // true: quem cria conta precisa digitar um código de convite (você define o código no banco, no item `convite`).
  // Recomendado para um grupo fechado de amigos e família.
  exigirConvite: true,

  // Endereços da API do Firebase. Não mude (só o emulador de testes muda estes valores).
  identityUrl: 'https://identitytoolkit.googleapis.com/v1',
  tokenUrl: 'https://securetoken.googleapis.com/v1',
};

export const cloudEnabled = () => Boolean(CLOUD.apiKey && CLOUD.databaseUrl);
