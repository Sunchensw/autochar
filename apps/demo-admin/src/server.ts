import path from 'node:path';
import express from 'express';

const app = express();
const port = Number(process.env.PORT ?? 4173);

const products = new Map([
  ['10001', { sku: '10001', title: '春季原始商品标题' }],
  ['10002', { sku: '10002', title: '夏季原始商品标题' }],
  ['10003', { sku: '10003', title: '促销原始商品标题' }]
]);

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'src', 'public')));

app.get('/api/products', (req, res) => {
  const keyword = String(req.query.sku ?? '').trim();
  const items = [...products.values()].filter(
    (product) => !keyword || product.sku.includes(keyword) || product.title.includes(keyword)
  );
  res.json({ items });
});

app.post('/api/products/:sku', (req, res) => {
  const sku = req.params.sku;
  const product = products.get(sku);
  if (!product) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  product.title = String(req.body.title ?? product.title);
  res.json({ product, message: '保存成功' });
});

app.listen(port, () => {
  console.log(`Autochar demo admin listening at http://localhost:${port}`);
});
