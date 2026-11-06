// Fluxos de conta: entrar/criar conta, sair deste aparelho e excluir a conta.
// Aqui ficam as REGRAS (o que fazer com os dados deste aparelho); as telas ficam em ui/account.js.
import { CloudError } from './firebase.js';

const EMAIL_OK = /^\S+@\S+\.\S+$/;
const MIN_PASSWORD = 8;

export const isEmail = (text) => EMAIL_OK.test(String(text ?? '').trim());

/**
 * Confere o que a pessoa digitou ANTES de falar com o servidor. Devolve `null` se está tudo certo, ou
 * `{ field, message }` com o campo que precisa de atenção (email | password | confirm | convite) e o texto para mostrar.
 * Ao criar a conta a senha é digitada duas vezes: um erro de digitação viraria uma conta cuja senha ninguém sabe.
 * A senha nunca é "aparada": espaços e maiúsculas contam, e as duas digitações têm que ser idênticas.
 */
export function validateCredentials({ mode, email, password, confirm = '', convite = '', exigirConvite = false }) {
  if (!isEmail(email)) return { field: 'email', message: 'Digite um e-mail válido.' };
  if (!password) return { field: 'password', message: 'Digite a senha.' };
  if (mode !== 'signUp') return null;
  if (password.length < MIN_PASSWORD) return { field: 'password', message: `Escolha uma senha com pelo menos ${MIN_PASSWORD} caracteres.` };
  if (!confirm) return { field: 'confirm', message: 'Digite a senha de novo, no campo de confirmação.' };
  if (confirm !== password) return { field: 'confirm', message: 'As senhas não são iguais. Confira e digite de novo.' };
  if (exigirConvite && !String(convite ?? '').trim()) return { field: 'convite', message: 'Digite o código de convite.' };
  return null;
}

/** O login é obrigatório? Só faz sentido com o Firebase configurado (sem ele não há onde entrar). */
export function loginRequired(config) {
  return Boolean(config?.apiKey && config?.databaseUrl && config?.exigirLogin);
}

/** Tem que mostrar a tela de entrada (e esconder o app) agora? */
export function needsLogin(config, session) {
  return loginRequired(config) && !session;
}

/**
 * Entra (ou cria a conta) e faz a primeira sincronização.
 * Regras para os dados que já existem neste aparelho:
 *  - dados de OUTRA conta nunca são misturados: são descartados;
 *  - só as tarefas de boas-vindas e a conta já tem dados: vale a conta;
 *  - tarefas do próprio usuário e a conta já tem dados: pergunta (mesclar ou descartar);
 *  - conta nova: as tarefas do aparelho sobem para ela.
 * @returns {{ok: boolean, cancelled?: boolean, sync?: object}}
 */
export async function connect({ cloud, sync, store, mode, email, password, convite = '', exigirConvite = true, askAdopt }) {
  const session = mode === 'signUp' ? await cloud.signUp(email, password, convite) : await cloud.signIn(email, password);
  try {
    const st = store.state;
    if (st.owner && st.owner !== session.uid) {
      store.resetForAccount(session.uid);
    } else if (!st.owner && (st.tasks.length > 0 || st.labels.length > 0)) {
      const remote = await cloud.dbGet(`users/${session.uid}`);
      if (remote && st.seed) {
        store.resetForAccount(session.uid);
      } else if (remote) {
        const choice = askAdopt ? await askAdopt({ tasks: st.tasks.length }) : 'merge';
        if (choice !== 'merge' && choice !== 'discard') {
          cloud.signOut();
          return { ok: false, cancelled: true };
        }
        if (choice === 'discard') store.resetForAccount(session.uid);
      }
    }
    store.setOwner(session.uid);
    const result = await sync.syncNow();
    if (!result.ok && mode === 'signUp' && result.code === 'permission') {
      // o banco recusou guardar os dados da conta nova (código de convite errado ou regras que não combinam com o app):
      // desfaz a conta recém-criada para a pessoa poder tentar de novo
      sync.stop();
      await cloud.deleteAccount().catch(() => {});
      store.setOwner(null);
      throw exigirConvite
        ? new CloudError('invite', 'Código de convite incorreto. Peça o código a quem convidou você.')
        : new CloudError('permission', 'O servidor recusou guardar os seus dados (regras do banco). Avise quem administra o serviço.');
    }
    return { ok: result.ok, sync: result };
  } catch (e) {
    if (cloud.session) cloud.signOut(); // nunca deixa "meio conectado"
    throw e;
  }
}

/**
 * Sai deste aparelho: antes tenta enviar o que falta e depois REMOVE as tarefas daqui
 * (elas continuam na conta; assim ninguém que usar este aparelho depois vê as suas).
 * Se não conseguir enviar, devolve { pending: true } e só sai com force = true.
 */
export async function disconnect({ cloud, sync, store, force = false }) {
  if (!force) {
    const r = await sync.syncNow();
    if (!r.ok && r.code !== 'off') return { ok: false, pending: true, message: r.message };
  }
  sync.stop();
  cloud.signOut();
  store.resetForAccount(null);
  return { ok: true };
}

/**
 * Exclui a conta e os dados da nuvem. As tarefas continuam neste aparelho, agora sem conta.
 * Pede a senha: confirma que é a própria pessoa e deixa o login "recente", que o Firebase exige para excluir a conta.
 * A senha é conferida ANTES de apagar qualquer coisa.
 */
export async function removeAccount({ cloud, sync, store, password }) {
  const uid = cloud.session?.uid;
  if (!uid) return { ok: false };
  if (!password) throw new CloudError('credentials', 'Digite sua senha para confirmar.');
  await cloud.reauthenticate(password);
  // para de sincronizar e espera a rodada em andamento: senão ela poderia regravar os dados logo depois de apagados
  sync.stop();
  await sync.whenIdle();
  sync.stop(); // a rodada que acabou de terminar pode ter agendado outra
  try {
    await cloud.dbDelete(`users/${uid}`);
    await cloud.deleteAccount();
  } catch (e) {
    sync.scheduleSoon(3000); // não deu para excluir: a sincronização volta ao normal
    throw e;
  }
  store.setOwner(null);
  return { ok: true };
}
