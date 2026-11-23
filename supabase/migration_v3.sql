-- De/para do cupom: guarda os textos abreviados do cupom que já foram associados a cada produto.
alter table products add column if not exists aliases text;
