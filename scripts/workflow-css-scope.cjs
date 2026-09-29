const selectorParser = require('postcss-selector-parser');

module.exports = () => ({
  postcssPlugin: 'opentu-workflow-css-scope',
  OnceExit(root) {
    if (!root.source?.input.file?.replaceAll('\\', '/').endsWith('/workflow-mode/web/src/styles/globals.css')) return;
    root.walkRules(rule => {
      // Nested selectors already inherit their parent's scope. Keyframe steps
      // are animation syntax rather than selectors.
      for (let parent = rule.parent; parent; parent = parent.parent) {
        if (parent.type === 'rule' || (parent.type === 'atrule' && /keyframes$/.test(parent.name))) return;
      }
      rule.selector = selectorParser(selectors => {
        selectors.each(selector => {
          let scoped = false;
          selector.each(node => {
            if ((node.type === 'pseudo' && [':root', ':host'].includes(node.value)) || (node.type === 'tag' && ['html', 'body'].includes(node.value))) {
              node.replaceWith(selectorParser.className({ value: 'workflow-app-root' }));
              scoped = true;
            }
          });
          if (selector.nodes[0]?.type === 'class' && selector.nodes[0].value === 'dark') {
            selector.prepend(selectorParser.className({ value: 'workflow-app-root' }));
            scoped = true;
          }
          if (!scoped) {
            selector.prepend(selectorParser.combinator({ value: ' ' }));
            selector.prepend(selectorParser.className({ value: 'workflow-app-root' }));
          }
        });
      }).processSync(rule.selector);
    });
  },
});
module.exports.postcss = true;
