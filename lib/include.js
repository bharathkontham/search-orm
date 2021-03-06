const R = require('ramda')
class Include {
  constructor(model) {
    model.getRelationalData = this.getRelationalData;
    model.getAllRecords = this.getAllRecords;
  }

  async getAllRecords(query, model, count, allRecords = []) {
    query.skip = allRecords.length
    query.limit = 1000
    const children = await model.find(query)
    allRecords = R.concat(allRecords, children)
    count = count - 1
    if (count) {
      return await this.getAllRecords(query, model, count, allRecords)
    } else {
      return allRecords;
    }
  }

  async getRelationalData(include, result) {
    if (typeof include == 'string') {
      include = [include]
    } else if (typeof include == 'object' && !Array.isArray(include)) {
      include = [include]
    }

    const childRecords = {}
    await Promise.all(include.map(async (property) => {
      let query = {}
      let prop = typeof property == 'string' ? property : property.relation;
      if (this.relationDefinitions[prop].type == 'hasMany') {
        query.where = {}
        query.where[this.relationDefinitions[prop].keyTo] = {
          inq: R.pluck(this.relationDefinitions[prop].keyFrom, result)
        }
      } else if (this.relationDefinitions[prop].type == 'hasOne') {
        query.where = {}
        query.where[this.relationDefinitions[prop].keyTo] = {
          inq: R.pluck(this.relationDefinitions[prop].keyFrom, result)
        }
      } else if (this.relationDefinitions[prop].type == 'belongsTo') {
        query.where = {}
        query.where[this.relationDefinitions[prop].modelTo.id.property] = {
          inq: R.pluck(this.relationDefinitions[prop].keyTo, result)
        }
      } else if (this.relationDefinitions[prop].type == 'hasManyThrough') {
        query.where = {}
        query.where[this.relationDefinitions[prop].keyFrom] = {
          inq: R.pluck(this.relationDefinitions[prop].modelFrom.id.property, result)
        }
      }
      childRecords[prop] = {
        relationType: this.relationDefinitions[prop].type
      }

      if (this.relationDefinitions[prop].type == 'hasMany') {
        if (typeof property == 'string') {
          const count = await this.relationDefinitions[property].modelTo['count'](query.where)
          if (count.count > 1000) {
            let c = count.count / 1000
            c = count.count % 1000 ? (c + 1) : c
            childRecords[property]['records'] = await this.getAllRecords(query, this.relationDefinitions[property].modelTo, c)
          } else {
            childRecords[property]['records'] = await this.relationDefinitions[property].modelTo['find'](query)
          }
        } else {
          query = property.scope ? R.mergeDeepWith(R.concat, property.scope, query) : query;
          const count = await this.relationDefinitions[prop].modelTo['count'](query.where)
          if (count.count > 1000) {
            let c = count.count / 1000
            c = count.count % 1000 ? (c + 1) : c
            childRecords[property.relation]['records'] = await this.getAllRecords(query, this.relationDefinitions[prop].modelTo, c)
          } else {
            childRecords[property.relation]['records'] = await this.relationDefinitions[prop].modelTo['find'](query)
          }
        }
      } else if (this.relationDefinitions[prop].type == 'hasManyThrough') {
        const count = await this.relationDefinitions[prop].modelThrough['count'](query.where);
        let modelThroughRecords;
        if (count.count > 1000) {
          let c = count.count / 1000
          c = count.count % 1000 ? (c + 1) : c
          modelThroughRecords = await this.getAllRecords(query, this.relationDefinitions[prop].modelThrough, c)
        } else {
          modelThroughRecords = await this.relationDefinitions[prop].modelThrough['find'](query)
        }
        let modelToQuery = {};
        modelToQuery.where = {}
        modelToQuery.where[this.relationDefinitions[prop].modelTo.id.property] = {
          inq: R.pluck(this.relationDefinitions[prop].keyThrough, modelThroughRecords)
        }
        modelToQuery = (typeof property === 'object' && property.scope) ? R.mergeDeepWith(R.concat, property.scope, modelToQuery) : modelToQuery;
        const modeToCount = await this.relationDefinitions[prop].modelTo['count'](modelToQuery.where);
       
        let modelToRecords = [];
        if (modeToCount.count > 1000) {
          let c = modeToCount.count / 1000
          c = modeToCount.count % 1000 ? (c + 1) : c
          
          modelToRecords = await this.getAllRecords(modelToQuery, this.relationDefinitions[prop].modelTo, c)
        } else {
          modelToRecords = await this.relationDefinitions[prop].modelTo['find'](modelToQuery)
        }
        childRecords[prop]['records'] = R.forEach((record) => {
          record.modelToRecord = R.find(R.propEq(this.relationDefinitions[prop].modelTo.id.property, record[this.relationDefinitions[prop].keyThrough]))(modelToRecords);
        }, modelThroughRecords);
      } else {
        if (typeof property == 'string') {
          childRecords[property]['records'] = await this.relationDefinitions[property].modelTo['find'](query)
        } else {
          query = property.scope ? R.mergeDeepWith(R.concat, property.scope, query) : query;
          childRecords[property.relation]['records'] = await this.relationDefinitions[prop].modelTo['find'](query)
        }
      }
    }))

    R.forEach((record) => {
      R.forEachObjIndexed((obj, prop) => {
        if(obj.relationType === "hasManyThrough") {
          const filteredRecords = [];
          R.forEach((childRecord) => {
            if(childRecord[this.relationDefinitions[prop].keyFrom] === record[this.id.property] && childRecord.modelToRecord) {
              filteredRecords.push(childRecord.modelToRecord);
            }
          }, obj['records']);
          record[prop] = filteredRecords;
        } else if (obj.relationType == 'belongsTo') {
          record[prop] = R.find(R.propEq(this.relationDefinitions[prop].modelTo.id.property, record[this.relationDefinitions[prop].keyTo]))(obj['records'])
        } else {
          record[prop] = R.filter(R.propEq(this.relationDefinitions[prop].keyTo, record[this.id.property]))(obj['records'])
        }
      }, childRecords)
    }, result)
  }

}

module.exports = Include