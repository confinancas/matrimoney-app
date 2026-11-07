// Contratos da configuração inicial e das chaves (TASK-0102), compartilhados entre o Worker e o app.
// Nenhum tipo aqui carrega uma chave: só a versão mascarada.

// configuracao: falta a chave da IA e não foi escolhido continuar sem IA.
// cadastro: com chave ou com "sem IA", e o primeiro acesso ainda não foi usado.
// pronto: o primeiro acesso foi usado (a TASK-0103 marca ao criar o lar).
export type SetupMode = "configuracao" | "cadastro" | "pronto";

export type SetupStatus = {
  mode: SetupMode;
  unlocked: boolean;
  masterKeyOk: boolean;
  hasMembers: boolean;
};

// readable: false quando há uma linha cifrada que a chave mestra atual não abre (ilegivel).
export type KeyStatus = {
  configured: boolean;
  masked: string | null;
  readable: boolean;
};

export type KeysResponse = {
  claude: KeyStatus;
  google: KeyStatus;
};

export type FeaturesResponse = {
  ia: boolean;
  assistente: boolean;
  voz: boolean;
};
