import test from 'node:test'
import assert from 'node:assert/strict'
import {validateFields, validateFieldValues, validateFieldBindings, validateCriteria} from '../shared/fields.js'

const fields = [
  {key: 'quantity', type: 'number', required: true},
  {key: 'method', type: 'select', options: ['Courier', 'Pickup'], required: true},
  {key: 'passed', type: 'boolean', required: true},
]
test('input validation distinguishes missing, wrong types, valid zero and false', () => {
  assert.equal(validateFields(fields), null)
  assert.deepEqual(validateFieldValues(fields, {quantity: 0, method: 'Pickup', passed: false}), [])
  for (const quantity of [NaN, Infinity, '12', null])
    assert.ok(validateFieldValues(fields, {quantity, method: 'Courier', passed: true}).length)
  for (const method of ['', 'Other', true])
    assert.ok(validateFieldValues(fields, {quantity: 12.5, method, passed: true}).length)
  assert.ok(validateFieldValues([{key: 'agree', type: 'boolean', confirm: true}], {agree: false}).length)
  assert.deepEqual(validateFieldValues([{key: 'optional', type: 'select', options: ['A']}], {}), [])
})

test('contradictory numeric and finite-choice rules cannot be confirmed or saved',()=>{
 for(const rule of [{gt:10,lte:5},{gte:5,lt:5},{gt:5,lte:5},{gte:5,lte:5,ne:5},{eq:4,gt:10},{eq:4,ne:4}]){
  assert.match(validateCriteria({quantity:rule},fields),/No value/)
  assert.match(validateFieldBindings({fields:[fields[0]],steps:[{id:'q',type:'task',fields:['quantity'],next:[{to:'a',criteria:{quantity:rule}}]}]}),/No value/)
 }
 for(const rule of [{gte:5,lte:5},{gt:5,lt:6},{eq:12,gt:10},{lt:0},{ne:10}])
  assert.equal(validateCriteria({quantity:rule},fields),null)
 assert.match(validateCriteria({passed:{eq:false}},[{key:'passed',type:'boolean',confirm:true}]),/No value/)
 assert.match(validateCriteria({method:{ne:'Courier'}},[{key:'method',type:'select',options:['Courier']}]),/No value/)
})
test('a saved form needs valid choices, collecting tasks and valid dropdown routes', () => {
  for (const options of [undefined, [], [''], ['A', 'A'], [' A']])
    assert.ok(validateFields([{key: 'method', type: 'select', options}]))
  const map = {fields, steps: [{id: 'input', type: 'task', fields: ['quantity', 'method', 'passed']}]}
  assert.equal(validateFieldBindings(map), null)
  assert.match(validateFieldBindings({...map, steps: [{id: 'input', type: 'task'}]}), /Assign/)
  assert.match(validateFieldBindings({...map, steps: [{...map.steps[0], type: 'approval'}]}), /task before/)
  map.steps.push({id: 'route', type: 'decision', next: [{to: 'ship', criteria: {method: {eq: 'Unknown'}}}]})
  assert.match(validateFieldBindings(map), /listed choice/)
  map.steps[1].next[0].criteria.method.eq = 'Courier'
  assert.equal(validateFieldBindings(map), null)
})
