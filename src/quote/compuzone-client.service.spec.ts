import test from 'node:test';
import assert from 'node:assert/strict';
import { CompuzoneClientService } from './compuzone-client.service';

test('parses compuzone product list html and filters complete pc results', () => {
  const service = new CompuzoneClientService();
  const html = `
    <li class="li-obj" id="li-pno-1013843">
      <a href="../product/product_detail.htm?ProductNo=1013843" class="prd_info_name prdTxt">[AMD] 라이젠7 라파엘 7800X3D</a>
      <div class="prd_subTxt"><a>8코어 16스레드</a></div>
      <div class="prd_price" data-price="378,000" data-discountprice="378,000"></div>
    </li>
    <li class="li-obj" id="li-pno-1318333">
      <a href="../product/product_detail.htm?ProductNo=1318333" class="prd_info_name prdTxt">[컴퓨존] 게이밍 추천 조립PC_R7817 (7800X3D/5060Ti)</a>
      <div class="prd_subTxt"><a>라이젠7 7800X3D / 지포스 RTX5060 Ti / 본체</a></div>
      <div class="prd_price" data-price="1,900,000" data-discountprice="1,672,000"></div>
    </li>
  `;

  const products = service.parseProductsFromHtml(html, 'cpu', '7800X3D');

  assert.equal(products[0].productNo, '1013843');
  assert.equal(products[0].price, 378000);
  assert.ok(products.every((product) => product.score > 0));
});
