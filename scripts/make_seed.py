import openpyxl, json, re, unicodedata, sys
base_xlsx, new_xlsx = sys.argv[1], sys.argv[2]
norm=lambda s:unicodedata.normalize('NFKD',re.sub(r'\s+',' ',str(s)).strip().lower()).encode('ascii','ignore').decode()
clean=lambda s:re.sub(r'\s+',' ',str(s)).strip()
CATS=[('Bebidas','#26C6DA'),('Limpeza','#FFE082'),('Higiene Pessoal','#B39DDB'),('Alimentação','#A5D6A7'),('Lanche','#FFC107'),('Padaria','#D7A86E'),('Hortifruti','#66BB6A'),('Carnes e Frios','#90B4F0'),('Laticínios','#80DEEA'),('Congelados','#81D4FA'),('Cuidados com a Casa','#90A4AE'),('Outros','#CFD8DC')]
catnames={c for c,_ in CATS}
prods={}; order=[]
def add(cat,name,price):
    k=norm(name)
    if not k: return
    if k in prods:
        if prods[k]['price'] is None and price is not None: prods[k]['price']=price
        return
    prods[k]={'name':clean(name),'category':cat if cat in catnames else 'Outros','price':price,'unit':'un'}; order.append(k)
# 1) planilha nova (original do usuário): produtos, preços, lista atual
ws=openpyxl.load_workbook(new_xlsx).worksheets[0]
cur=[]
for r in ws.iter_rows(min_row=2,values_only=True):
    cat,name,qtd,ok,price=r[:5]
    if not name: continue
    add(cat,name,price)
    if qtd: cur.append({'name':clean(name),'qty':qtd})
orig=len(order)
# 2) base ampliada (a que já entreguei na planilha)
wb=openpyxl.load_workbook(base_xlsx,data_only=True)['Base de Produtos']
for r in wb.iter_rows(min_row=2,values_only=True):
    if r[1]: add(r[0],r[1],r[2])
out={'categories':[{'name':n,'color':c} for n,c in CATS],'products':[prods[k] for k in order],'currentList':cur,'originalCount':orig}
json.dump(out,open('src/seed.json','w'),ensure_ascii=False,indent=0)
print('originais',orig,'total',len(order),'lista atual',len(cur))
