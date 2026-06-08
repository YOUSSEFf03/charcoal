/* Injects Tabler icon glyph rules at runtime.
   The preview sandbox strips `content:` from served .css files, but a
   JS-created <style> is left intact — so icons must be wired up here. */
(function () {
  var glyphs = {
    'flame': 'ec2c', 'layout-dashboard': 'f02c', 'chart-bar': 'ea59', 'package': 'eaff',
    'building-warehouse': 'ebe3', 'box': 'ea45', 'shopping-bag': 'f5f8', 'users': 'ebf2',
    'user-plus': 'eb4b', 'file-invoice': 'eb67', 'cash': 'ea55', 'scale': 'ebc2',
    'receipt-2': 'edfa', 'cash-banknote': 'ee25', 'coin': 'eb82', 'user': 'eb4d',
    'truck': 'ebc4', 'settings': 'eb20', 'chevron-left': 'ea60', 'chevron-right': 'ea61',
    'arrow-left': 'ea19', 'arrow-up-right': 'ea24', 'edit': 'ea98', 'receipt': 'edfd',
    'calendar': 'ea53', 'table': 'eba1', 'pencil': 'eb04', 'phone': 'eb09',
    'brand-whatsapp': 'ec74', 'star': 'eb2e', 'clipboard-text': 'f089', 'activity': 'ed23',
    'printer': 'eb0e', 'currency-dollar': 'eb84', 'table-export': 'eef8',
    'circle-check': 'ea67', 'check': 'ea5e', 'plus': 'eb0b', 'search': 'eb1c', 'x': 'eb55'
  };
  var css = '.ti{font-family:"tabler-icons-local","tabler-icons"!important;font-style:normal;font-weight:400;line-height:1;display:inline-block;-webkit-font-smoothing:antialiased}';
  Object.keys(glyphs).forEach(function (name) {
    css += '.ti-' + name + '::before{content:"\\' + glyphs[name] + '"}';
  });
  var s = document.createElement('style');
  s.id = 'tabler-glyphs';
  s.textContent = css;
  document.head.appendChild(s);
})();
