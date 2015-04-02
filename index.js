function traverse(node, fn) {
    var k, v;
    for (k in node) {
        v = node[k];
        if (v !== null && typeof v !== "string") {
            fn(v);
            traverse(v, fn);
        }
    }
}

function newLiteral(value) {
    return { type: "Literal", value: value, raw: "\""+value+"\"" };
}

function newIdentifier(name) {
    return { type: "Identifier", name: name };
}

function newMemberExpression(o, p) {
    return {
        type: "MemberExpression",
        computed: p === "default",
        object: newIdentifier(o),
        property: p === "default" ? newLiteral(p) : newIdentifier(p)
    };
}

function newAssignmentExpressionStatement(left, right) {
    return {
        type: "ExpressionStatement",
        expression: {
            type: "AssignmentExpression",
            operator: "=",
            left: left,
            right: right
        }
    };
}

var scopeDeclarations = function(node) {
    var ret = [], k;
    switch (node && node.type) {
        case 'VariableDeclaration':
            return node.declarations.map(function(node) { return node.id; });
        case 'FunctionDeclaration':
            return [node.id];
        case 'FunctionExpression':
            return [];
    }

    for (k in node) {
        if (typeof node[k] === "object") {
            ret = ret.concat(scopeDeclarations(node[k]));
        }
    }
    return ret;
};

function prefixvar(node, name, obj, member, throwonleft) {
    var matches = function(id) {
        return id.name === name;
    };

    var key, i;

    switch (node && node.type) {
        case "Identifier":
            if (node.name === name) {
                return newMemberExpression(obj, member);
            }
            return node;

        case "MemberExpression":
            if (node.property.type !== "Identifier") {
                node.property = prefixvar(
                    node.property,
                    name,
                    obj,
                    member,
                    throwonleft
                );
            }

            node.object = node.object.name === name ?
                newMemberExpression(obj, member) :
                prefixvar(node.object, name, obj, member, throwonleft);
            return node;

        case "ObjectExpression":
            for (i=0; i<node.properties.length; i++) {
                node.properties[i].value = prefixvar(
                    node.properties[i].value,
                    name,
                    obj,
                    member,
                    throwonleft
                );
            }
            return node;

        case "VariableDeclaration":
            node.declarations = node.declarations.map(function(d) {
                if (d.id.name === name) {
                    if (d.init) {
                        d.init = newAssignmentExpressionStatement(
                            newMemberExpression(obj, member),
                            d.init).expression;
                    }
                } else {
                    d.init = prefixvar(d.init, name, obj, member, throwonleft);
                }
                return d;
            });
            return node;

        case "FunctionDeclaration":
            if (matches(node.id)) {
                return newAssignmentExpressionStatement(
                    newMemberExpression(obj, member),
                    node
                );
            }
            if (matches(node.id||{}) ||
                node.params.some(matches) ||
                scopeDeclarations(node.body).some(matches)) {
                return node;
            }
            break;
        case "FunctionExpression":
            if (matches(node.id||{}) ||
                node.params.some(matches) ||
                scopeDeclarations(node.body).some(matches)) {
                return node;
            }
            break;

        case 'CatchClause':
            if (node.param.name === name) {
                return node;
            }
            break;

        case 'ImportDeclaration':
            return node;

        case 'AssignmentExpression':
            if (throwonleft) {
                if (node.left.type === 'Identifier' &&
                    node.left.name === name) {
                    throw new SyntaxError(
                        "Cannot reassign imported binding `"+name+"`");
                }
            }
            break;

        case 'UpdateExpression':
            if (throwonleft) {
                if (node.argument.type === 'Identifier' &&
                    node.argument.name === name) {
                    throw new SyntaxError(
                        "Cannot reassign imported binding `"+name+"`");
                }
            }
            break;
    }

    for (key in node) {
        if (typeof node[key] === "object") {
            node[key] = prefixvar(node[key], name, obj, member, throwonleft);
        }
    }
    return node;
}

var definify = function(depnames, body) {
    return [{
        type: "ExpressionStatement",
        expression: {
            type: "CallExpression",
            callee: {
                type: "Identifier",
                name: "define"
            },
            arguments: [
                {
                    type: "ArrayExpression",
                    elements: depnames.concat(["exports"]).map(function(n) {
                        return newLiteral(n);
                    })
                },
                {
                    type: "FunctionExpression",
                    params: depnames.concat([null]).map(function(n, i) {
                        return newIdentifier(
                            "__"+(n?"uDep"+i:"exports")+"__");
                    }),
                    body: {
                        type: "BlockStatement",
                        body: body
                    }
                }
            ]
        }
    }];
};

module.exports.transpileAST = function transpileAST(ast) {
    var i, node, j, spec, idx, id, name, t, d,
        importMods = [],
        importNames = [],
        importNameMap = {};

    function addImport(id, name, source) {
        // add name to import list
        if (!~importMods.indexOf(source)) {
            importMods.push(source);
        }
        if (~importNames.indexOf(name)) {
            throw new SyntaxError("expected one declaration for `"+name+"`");
        }
        importNames.push(name);
        importNameMap[id] = name;
    }

    function throwIfImportOrExport(node) {
        if (node.type === "ExportDeclaration" ||
            node.type === "ImportDeclaration") {
            throw new SyntaxError("Unexpected non-top level " + node.type);
        }
    }

    for (i=0; i<ast.body.length; i++) {
        node = ast.body[i];

        if (node.type === "ImportDeclaration") {
            // importing
            if (!node.kind) {
                // `import "./foo"`
                addImport(null, null, node.source.value);
            } else {
                for (j=0; j<node.specifiers.length; j++) {
                    // `import { a, b } from "./foo"`
                    // `import { a as bar, b } from "./foo"`
                    // `import a from "./foo"`
                    spec = node.specifiers[j];
                    id = node.kind === "named" ? spec.id.name : "default";
                    name = spec.name ? spec.name.name : spec.id.name;

                    addImport(id, name, node.source.value);
                    idx = importMods.indexOf(node.source.value);
                    ast = prefixvar(ast, name, "__uDep"+idx+"__", id, true);
                }
            }

            // remove node
            ast.body.splice(i--, 1);
        } else if (node.type === "ExportDeclaration") {
            // exporting
            if (node.default === true) {
                // transform to assignment
                ast.body[i] = newAssignmentExpressionStatement(
                    newMemberExpression("__exports__", "default"),
                    node.declaration);

                // TODO: check if following statement always empty
                //ast.body.splice(i+1, 1);
            } else if ((d = node.declaration)) {
                // `export var foo = "bar"`
                // `export function func(...) { ... }`
                t = d.type === "VariableDeclaration" ? d.declarations[0] : d;

                // transform to assignment
                ast.body[i] = newAssignmentExpressionStatement(
                    newMemberExpression("__exports__", t.id.name),
                    d.type === "VariableDeclaration" ? t.init : t);

                ast = prefixvar(ast, t.id.name, "__exports__", t.id.name);
            } else if (node.specifiers && node.specifiers.length > 0) {
                // remove node
                ast.body.splice(i--, 1);

                if (node.source) {
                    // `export { foo, bar } from "library"`
                    addImport(null, null, node.source.value);
                    idx = importMods.indexOf(node.source.value);

                    // TODO: binding instead of assignment
                    for (j=0; j<node.specifiers.length; j++) {
                        spec = node.specifiers[j];
                        id = spec.id.name;
                        name = spec.name ? spec.name.name : spec.id.name;

                        ast.body.splice(
                            ++i,
                            0,
                            newAssignmentExpressionStatement(
                                newMemberExpression("__exports__", name),
                                newMemberExpression("__uDep"+idx+"__", id)
                            )
                        );
                    }
                } else {
                    // `export { foo, bar }`
                    for (j=0; j<node.specifiers.length; j++) {
                        spec = node.specifiers[j];

                        // TODO: check if this reexport shoud be a binding
                        if (spec.id.type === "MemberExpression" &&
                                /__uDep/.test(spec.id.object.name)) {
                            ast.body.splice(
                                ++i,
                                0,
                                newAssignmentExpressionStatement(
                                    newMemberExpression(
                                        "__exports__",
                                        importNameMap[spec.id.property.name||
                                            spec.id.property.value]
                                    ),
                                    spec.id
                                )
                            );
                        } else {
                            name = spec.id.name;
                            ast = prefixvar(ast, name, "__exports__", name);
                        }
                    }
                }
            }
        } else {
            // neither import nor export, check for non toplevel import/exports
            traverse(node, throwIfImportOrExport);
        }
    }

    ast.body = definify(importMods, ast.body);
    return ast;
};
