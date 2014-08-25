/* globals describe, it */
var assert = require("assert"),
    fs = require("fs"),
    path = require("path"),
    vm = require("vm");

var esprima = require("esprima"),
    recast = require("recast");

var transpiler = require("..");

var uAMD = fs.readFileSync(path.join(
    __dirname,
    "..",
    "node_modules",
    "esx-bundle",
    "uAMD.js"));



function run(mods) {
    var init = {
        assert:assert,
        console:console
    };
    init.global = init;

    var ctx = vm.createContext(init);
    vm.runInContext(uAMD, ctx);

    var k, v, errorMatch, ast, result;

    var compile = function() {
        ast = transpiler.transpileAST(recast.parse(v, {esprima:esprima}).program);
    };

    var processCompileError = function(err) {
        var errorInfo = errorMatch[1];
        var expectedType = errorInfo.match(/type=([a-zA-Z]+)/)[1];
        assert.equal(expectedType, err.constructor.name);
        return true;
    };

    for (k in mods) {
        v = mods[k];

        errorMatch = v.match(/\/\*\s*error:\s*(.+?)\*\//);
        if (errorMatch) {
            assert.throws(compile, processCompileError, errorMatch[1]);
            return;
        } else {
            compile();
        }

        ast.body[0].expression.arguments.unshift({
            type: "Literal",
            value: k
        });

        result = recast.print(ast).code;
        vm.runInContext(result, ctx, k);
    }

    Object.keys(mods).forEach(function(k) {
        vm.runInContext("require(\"" +k+ "\")", ctx);
    });
}



var dirs = [ "esnext", "local" ];
dirs.forEach(function(dir) {
    describe(dir, function() {
        var subdirs = fs.readdirSync(path.join("test", dir));
        subdirs.forEach(function(subdir) {
            describe(subdir, function() {
                it('should pass', function() {
                    var files = fs.readdirSync(path.join("test", dir, subdir)),
                        mods = {};
                    files.forEach(function(file) {
                        if (!/\.js/.test(file)) {
                            return "";
                        }
                        var filename = path.join("test", dir, subdir, file),
                            content = fs.readFileSync(filename).toString();
                        mods["./"+file.replace(/\.js$/, "")] = content;
                    });
                    run(mods);
                });
            });
        });
    });
});
