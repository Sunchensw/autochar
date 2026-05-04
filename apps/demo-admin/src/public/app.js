const skuInput = document.querySelector('#skuInput');
const searchButton = document.querySelector('#searchButton');
const productRows = document.querySelector('#productRows');
const editor = document.querySelector('#editor');
const titleInput = document.querySelector('#titleInput');
const saveButton = document.querySelector('#saveButton');
const toast = document.querySelector('#toast');
let activeSku = '';

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2000);
}

async function search() {
  const response = await fetch(`/api/products?sku=${encodeURIComponent(skuInput.value)}`);
  const data = await response.json();
  productRows.innerHTML = '';
  for (const product of data.items) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${product.sku}</td>
      <td>${product.title}</td>
      <td><button type="button" data-edit="${product.sku}">编辑</button></td>
    `;
    productRows.append(row);
  }
}

productRows.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-edit]');
  if (!button) return;
  const row = button.closest('tr');
  activeSku = button.dataset.edit;
  titleInput.value = row.children[1].textContent;
  editor.hidden = false;
  titleInput.focus();
});

searchButton.addEventListener('click', search);
skuInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') search();
});

saveButton.addEventListener('click', async () => {
  const response = await fetch(`/api/products/${encodeURIComponent(activeSku)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: titleInput.value })
  });
  const data = await response.json();
  showToast(data.message || '保存成功');
  await search();
});

search();
