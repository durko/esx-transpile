/* globals assert */
import { a } from "./exporter";

assert.equal(a, 42);

try {
    throw new Error("some error");
} catch (a) {
    assert.equal(a.message, "some error");
}

function foo() {
    assert.equal(a, 42);
}
foo();

function bar(a) {
    assert.notEqual(a, 42);
}
bar();

function baz() {
    assert.equal(a, undefined);
    var a = 666; // jshint ignore:line
    assert.equal(a, 666);
}
baz();

function outer() {
    assert.equal(a, 42);
    function inner() {
        var a = 666;
        assert.equal(a, 666);
    }
    inner();
    assert.equal(a, 42);
}
outer();

var a, b, c;
export { a, b, c };
