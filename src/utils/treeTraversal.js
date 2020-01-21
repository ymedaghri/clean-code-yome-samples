const { pick } = require("lodash");

module.exports = {
    treeTraversal(tree, subField, attributes) {
        let queue = [];
        let result = [pick(tree, attributes)];
        let next = tree;
        while (next) {
            if (next[subField]) {
                next[subField].forEach(sub => {
                    queue.push(sub);
                    result.push(pick(sub, attributes));
                });
            }
            next = queue.shift();
        }
        return result;
    }
};
