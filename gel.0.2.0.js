(function(global, undefined){

    function fastEach(items, callback) {
        for (var i = 0; i < items.length; i++) {
            if (callback(items[i], i, items)) break;
        }
        return items;
    }
    
    function Token(converter, substring, characters){
        simpleExtend(this, converter);
        this.original = substring;
        this.length = characters;
    }
    
    function simpleExtend(target, source){
        for(var key in source){
            if(source.hasOwnProperty(key)){
                target[key] = source[key];
            }
        }
    }

    function Scope(oldScope){
        this.__scope__ = {};
        this.__outerScope__ = oldScope;
    }
    Scope.prototype.get = function(key){
        if(key in this.__scope__){
            return this.__scope__[key];
        }
        return this.__outerScope__ && this.__outerScope__.get(key);
    };
    Scope.prototype.set = function(key, value){
        this.__scope__[key] = value;
        return this;
    };
    Scope.prototype.add = function(obj){
        for(var key in obj){
            this.__scope__[key] = obj[key];
        }
        return this;
    };

    var errors = {
        UnknownFunction: "Function is undefined in  given expression: {0}. (add it to the Gel.functions object)",
        UnparseableToken: "Unable to determine next token in expression: ",
        BadNesting: "Invalid nesting. Un-opened {1} encountered at character:{0}.",//:{0}, {1} {2},
        BadStringTerminals: "Unmatched string terminals (the \" things)",
        UnknownIdentifier: "An unknown identifier ({0}) has been encountered (it did not resolve to a function or variable). If it is meant to be a function add it to the Gel.functions object."
    };
        
    function noop(){}
    
    function stringFormat(string, values){    
        return string.replace(/{(\d+)}/g, function(match, number) { 
            return typeof values[number] != 'undefined'
              ? values[number]
              : match
            ;
        });
    }
    
    // Takes a start and end regex, returns an appropriate parse function
    function createNestingParser(openRegex, closeRegex){
        return function(tokens, index){
            if(this.original.match(openRegex)){
                var position = index,
                    opens = 1;
                    
                while(position++, position <= tokens.length && opens){
                    if(!tokens[position]){
                        throw errors.BadNesting;
                    }
                    if(tokens[position].original.match(openRegex)){
                        opens++;
                    }
                    if(tokens[position].original.match(closeRegex)){
                        opens--;
                    }
                }
                if(position > tokens.length){
                    throw "not grouped";
                }
                
                // remove all wrapped tokens from the token array,
                // and add them as child tokens.
                this.childTokens = parse(tokens.splice(index + 1, position - 2 - index));
                
                //Remove nesting end token
                tokens.splice(index+1,1);
            }else{
                // If a nesting end token is found during parsing,
                // there is invalid nesting,
                // because the opening token should remove its closing token.
                throw errors.BadNesting;
            }
        };
    }
    
    function callWith(fn, scope, fnArguments, calledToken){
        var argIndex = 0,
            args = {
                callee: calledToken,
                length: fnArguments.length,
                raw: function(evaluated){
                    var rawArgs = fnArguments.slice();
                    if(evaluated){
                        fastEach(rawArgs, function(arg){
                            if(arg instanceof Token){
                                arg.evaluate(scope);
                            }
                        });
                    }
                    return rawArgs;
                },
                get: function(index){
                    var arg = fnArguments[index];
                        
                    if(arg instanceof Token){
                        arg.evaluate(scope);
                        return arg.result;
                    }
                    return arg;
                },
                hasNext: function(){
                    return argIndex < fnArguments.length;
                },
                next: function(){
                    if(!this.hasNext()){
                        throw "Incorrect number of arguments";
                    }
                    if(fnArguments[argIndex] instanceof Token){
                        fnArguments[argIndex].evaluate(scope);
                        return fnArguments[argIndex++].result;
                    }
                    return fnArguments[argIndex++];
                },
                all: function(){
                    var allArgs = [];
                    while(this.hasNext()){
                        allArgs.push(this.next());
                    }
                    return allArgs;
                }
            };
            
        return fn(scope, args);
    }

    function detectString(converter, expression, stringTerminal, stringType) {
        if (expression.charAt(0) === stringTerminal) {
            var index = 0,
            escapes = 0;
                   
            while (expression.charAt(++index) !== stringTerminal)
            {
                   if(index >= expression.length){
                           throw "Unclosed "+ stringType + " string";
                   }
                   if (expression.charAt(index) === '\\' && expression.charAt(index+1) === stringTerminal) {
                           expression = expression.slice(0, index) + expression.slice(index + 1);
                           escapes++;
                   }
            }

            return new Token(
                   converter,
                   expression.slice(0, index+1),
                   index + escapes + 1
            );
        }
    }

    var tokenConverters = {
            nests: {
                "parentheses": {
                    tokenise: function convertParenthesisToken(substring) {
                        if(substring.charAt(0) === '(' || substring.charAt(0) === ')'){
                            return new Token(this, substring.charAt(0), 1);
                        }
                    },
                    parse:createNestingParser(new RegExp('^\\($'),new RegExp('^\\)$')),
                    evaluate:function(scope){
                        scope = new Scope(scope);
                            
                        var functionToken = this.childTokens[0];
                        
                        functionToken.evaluate(scope);
                            
                        this.result = callWith(functionToken.result, scope, this.childTokens.slice(1), this);
                    }
                },
                "function": {
                    tokenise: function convertFunctionToken(substring) {
                        if(substring.charAt(0) === '{' || substring.charAt(0) === '}'){
                            return new Token(this, substring.charAt(0), 1);
                        }
                    },
                    parse: createNestingParser(new RegExp('^\\{$'),new RegExp('^\\}$')),
                    evaluate:function(scope){
                        var parameterNames = this.childTokens.slice(),
                            fnBody = parameterNames.pop();
                                                
                        this.result = function(scope, args){
                            scope = new Scope(scope);
                                
                            for(var i = 0; i < parameterNames.length; i++){
                                scope.set(parameterNames[i].original, args.get(i));
                            }
                            
                            fnBody.evaluate(scope);
                            
                            return fnBody.result;
                        }
                    }
                },
                
                // Trust me, period is a kind of nest.
                
                "period": {
                    tokenise: function convertPeriodToken(substring) {
                        var periodConst = ".";
                        if (substring.charAt(0) === periodConst) return new Token(this, ".", 1);
                        return;
                    },
                    parse: function(tokens, position){
                        this.targetToken = tokens.splice(position-1,1)[0];
                        this.identifierToken = tokens.splice(position,1)[0];
                        return -1;
                    },
                    evaluate:function(scope){
                        this.targetToken.evaluate(scope);
                        if(
                            this.targetToken.result &&
                            (typeof this.targetToken.result === 'object' || typeof this.targetToken.result === 'function')
                            && this.targetToken.result.hasOwnProperty(this.identifierToken.original)
                        ){
                            this.result = this.targetToken.result[this.identifierToken.original];
                        }else{
                            this.result = undefined;
                        }
                    }
                }
            },
            primitives: {
                "delimiter": {
                    tokenise: function convertdelimiterToken(substring) {
                        var i = 0;
                        while (i < substring.length && substring.charAt(i).trim() === "" || substring.charAt(i) === ',') {
                            i++;
                        }
                
                        if (i) return new Token(this, substring.slice(0, i), i);
                    },
                    parse:function(tokens, position){
                        tokens.splice(position, 1);
                        return -1;
                    }
                },
                "string": {
                    tokenise: function convertStringToken(substring) {
                        return detectString(this, substring, '"', "double quoted");
                    },
                    parse:noop,
                    evaluate:function(){
                        this.result = this.original.slice(1, -1);
                    }
                },
                "singleQuoteString": {
                    tokenise: function convertStringToken(substring) {
                        return detectString(this, substring, "'", "single quoted");
                    },
                    parse:noop,
                    evaluate:function(){
                        this.result = this.original.slice(1, -1);
                    }
                },            
                "number": {
                    tokenise: function convertNumberToken(substring) {
                        var specials = {
                            "NaN": Number.NaN,
                            "-NaN": Number.NaN,
                            "Infinity": Infinity,
                            "-Infinity": -Infinity
                        };
                        for (var key in specials) {
                            if (substring.slice(0, key.length) === key) {
                                return new Token(this, key, key.length);
                            }
                        }
                
                        var valids = "0123456789-.Eex",
                            index = 0;
                            
                        while (valids.indexOf(substring.charAt(index)||null) >= 0 && ++index) {}
                
                        if (index > 0) {
                            var result = substring.slice(0, index);
                            if(isNaN(parseFloat(result))){
                                return;
                            }
                            return new Token(this, result, index);
                        }
                
                        return;
                    },
                    parse:noop,
                    evaluate:function(){
                        this.result = parseFloat(this.original);
                    }
                }
            },
            identifiers:{
                "identifier":{
                    tokenise: function convertIndentifierToken(substring) {
                        // searches for valid identifiers or operators
                        //operators
                        var operators = "!=<>/&|*%-^?+\\",
                            index = 0;
                            
                        while (operators.indexOf(substring.charAt(index)||null) >= 0 && ++index) {}
                
                        if (index > 0) {
                            return new Token(this, substring.slice(0, index), index);
                        }
                
                        // identifiers (ascii only)
                        //http://www.geekality.net/2011/08/03/valid-javascript-identifier/
                        //https://github.com/mathiasbynens/mothereff.in/tree/master/js-variables
                        var valid = /^[$A-Z_][0-9A-Z_$]*/i;
                
                        var possibleidentifier = valid.exec(substring);
                        if (possibleidentifier && possibleidentifier.index === 0) {
                            var match = possibleidentifier[0];
                
                            return new Token(this, match, match.length);
                        }
                    },                    
                    parse:noop,
                    evaluate:function(scope){
                        this.result = scope.get(this.original);
                    }
                }
            }
        },        
        reservedKeywords = {            
            "boolean": {
                tokenise: function convertBooleanToken(identifier) {
                    if (identifier.original === "true") {
                        return new Token(this, "true", 4);
                    }
                    else if (identifier.original === "false") {
                        return new Token(this, "false", 5);
                    }
            
                    return;
                },
                parse: noop,
                evaluate:function(){
                    this.result = this.original === "true";
                }
            },
            "null": {
                tokenise: function convertNullToken(identifier) {
                    var nullConst = "null";
                    if (identifier.original === nullConst) return new Token(this, "null", nullConst.length);
                    return;
                },
                parse: noop,
                evaluate:function(){
                    this.result = null;
                }
            },
            "undefined": {
                tokenise: function convertUndefinedToken(identifier) {
                    var undefinedConst = "undefined";
                    if (identifier.original === undefinedConst) return new Token(this, "undefined", undefinedConst.length);
                    return;
                },
                parse: noop,
                evaluate:function(){
                    this.result = undefined;
                }
            }
        },
        functions = {
            "toString":function(scope, args){
                return "" + args.next();
            },
            "+":function(scope, args){
                return args.next() + args.next();
            },
            "-":function(scope, args){
                return args.next() - args.next();
            },
            "/":function(scope, args){
                return args.next() / args.next();
            },
            "*":function(scope, args){
                return args.next() * args.next();
            },
            "isNaN":function(scope, args){
                return isNaN(args.get(0));
            },
            "max":function(scope, args){
                var result = args.next();
                while(args.hasNext()){
                    result = Math.max(result, args.next());
                }
                return result;
            },
            "min":function(scope, args){
                var result = args.next();
                while(args.hasNext()){
                    result = Math.min(result, args.next());
                }
                return result;
            },
            ">":function(scope, args){
                return args.next() > args.next();
            },
            "<":function(scope, args){
                return args.next() < args.next();
            },
            ">=":function(scope, args){
                return args.next() >= args.next();
            },
            "<=":function(scope, args){
                return args.next() <= args.next();
            },
            "double":function(scope, args){
                return args.next() * 2;
            },
            "?":function(scope, args){
                return args.next() ? args.next() : args.get(2);
            },
            "!":function(scope, args){
                return !args.next();
            },
            "=":function(scope, args){
                return args.next() == args.next();
            },
            "==":function(scope, args){
                return args.next() === args.next();
            },
            "!=":function(scope, args){
                return args.next() != args.next();
            },
            "!==":function(scope, args){
                return args.next() !== args.next();
            },
            "||":function(scope, args){
                var nextArg;
                while(args.hasNext()){
                    nextArg = args.next();
                    if(nextArg){
                        return nextArg;
                    }
                }
                return nextArg;
            },
            "|":function(scope, args){
                var nextArg;
                while(args.hasNext()){
                    nextArg = args.next();
                    if(nextArg === true ){
                        return nextArg;
                    }
                }
                return nextArg;
            },
            "&&":function(scope, args){
                var nextArg;
                while(args.hasNext()){
                    nextArg = args.next();
                    if(!nextArg){
                        return false;
                    }
                }
                return nextArg;
            },
            "object":function(scope, args){
                var result = {};
                while(args.hasNext()){
                    result[args.next()] = args.next();
                }
                return result;
            },
            "array":function(scope, args){
                var result = [];
                while(args.hasNext()){
                    result.push(args.next());
                }
                return result;
            },
            "map":function(scope, args){
                var source = args.next(),
                    isArray = Array.isArray(source),
                    result = isArray ? [] : {},
                    functionToken = args.next();

                if(isArray){
                    fastEach(source, function(item, index){
                        result[index] = callWith(functionToken, scope, [item]);
                    });
                }else{
                    for(var key in source){
                        result[key] = callWith(functionToken, scope, [source[key]]);
                    };
                }  
                
                return result;
            },
            "sort": function(scope, args) {
                var args = args.all(),
                    result;
                
                var array = args[0];
                var functionToCompare = args[1];
                
                if (Array.isArray(array)) {
                
                    result = array.sort(function(a,b){
                        return callWith(functionToCompare, scope, [a,b]);
                    });

                    return result;
                
                }else {
                    return;
                }
            },
            "filter": function(scope, args) {
                var args = args.all(),
                    filteredList = [];
                    
                if (args.length < 2) {
                    return args;
                }
                


                var array = args[0],
                    functionToCompare = args[1];
                
                if (Array.isArray(array)) {
                    
                    fastEach(array, function(item, index){
                        if(typeof functionToCompare === "function"){
                            if(callWith(functionToCompare, scope, [item])){ 
                                filteredList.push(item);
                            }
                        }else{
                            if(item === functionToCompare){ 
                                filteredList.push(item);
                            }
                        }
                    });
                    return filteredList;                
                }
            },
            "findOne": function(scope, args) {
                var args = args.all(),
                    result;
                    
                if (args.length < 2) {
                    return args;
                }
                


                var array = args[0],
                    functionToCompare = args[1];
                
                if (Array.isArray(array)) {
                    
                    fastEach(array, function(item, index){
                        if(callWith(functionToCompare, scope, [item])){ 
                            result = item;
                            return true;
                        }
                    });
                    return result;              
                }
            },
            "concat":function(scope, args){
                var result = args.next();
                while(args.hasNext()){
                    if(result == null || !result.concat){
                        return undefined;
                    }
                    result = result.concat(args.next());
                }
                return result;
            },
            "join":function(scope, args){
                args = args.all();

                return args.slice(1).join(args[0]);
            },
            "slice":function(scope, args){
                var target = args.next(),
                    start,
                    end;

                if(args.hasNext()){
                    start = target;
                    target = args.next();
                }
                if(args.hasNext()){
                    end = target;
                    target = args.next();
                }
                
                return target.slice(start, end);
            },
            "last":function(scope, args){
                var array = args.next();

                if(!Array.isArray(array)){
                    return;
                }
                return array.slice(-1).pop();
            },
            "length":function(scope, args){
                return args.next().length;
            },
            "getValue":function(scope, args){
                var target = args.next(),
                    key = args.next();

                if(!target || typeof target !== 'object'){
                    return;
                }

                return target[key];
            },
            "compare":function(scope, args){
                var args = args.all(),
                    comparitor = args.pop(),
                    reference = args.pop(),
                    result = true,
                    objectToCompare;
                                    
                while(args.length){
                    objectToCompare = args.pop();
                    for(var key in objectToCompare){
                        if(!callWith(comparitor, scope, [objectToCompare[key], reference[key]])){
                            result = false;
                        }
                    }
                }
                
                return result;
            },
            "contains": function(scope, args){
                var args = args.all(),
                    target = args.shift(),
                    success = true,
                    strict = false;
                    
                if(target == null){
                    return;
                }
                    
                if(typeof target === 'boolean'){
                    strict = target;
                    target = args.shift();
                }
                
                if(!strict && typeof target === "string"){
                    target = target.toLowerCase();
                }
                    
                fastEach(args, function(arg){
                    
                    if(!strict && typeof arg === "string"){
                        arg = arg.toLowerCase();
                    }
                    if(target.indexOf(arg)<0){
                        success = false;
                        return true;
                    }
                });
                return success;
            },
            "charAt":function(scope, args){
                var target = args.next(),
                    position;

                if(args.hasNext()){
                    position = args.next();
                }

                if(typeof target !== 'string'){
                    return;
                }

                return target.charAt(position);
            },
            "toLowerCase":function(scope, args){
                var target = args.next();

                if(typeof target !== 'string'){
                    return undefined;
                }

                return target.toLowerCase();
            },
            "format": function format(scope, args) {
                var args = args.all();
                
                return stringFormat(args.shift(), args);
            },
            "refine": function(scope, args){
                var args = args.all(),
                    exclude = typeof args[0] === "boolean" && args.shift(),
                    original = args.shift(),
                    refined = {};
                    
                for(var i = 0; i < args.length; i++){
                    args[i] = args[i].toString();
                }

                for(var key in original){
                    if(args.indexOf(key)>=0){
                        !exclude && (refined[key] = original[key]);
                    }else if(exclude){
                        refined[key] = original[key];
                    }
                }
                
                return refined;
            },
            "date": (function(){
                var date = function(scope, args) {
                    return args.length ? new Date(args.length > 1 ? args.all() : args.next()) : new Date();
                };
                
                date.addDays = function(scope, args){
                    var baseDate = args.next();

                    return new Date(baseDate.setDate(baseDate.getDate() + args.next()));
                }
                
                return date;
            })(),
            "toJSON":function(scope, args){
                return JSON.stringify(args.next());
            },
            "fromJSON":function(scope, args){
                return JSON.parse(args.next());
            },
            "fold": function(scope, args){
                var args = args.all(),
                    fn = args.pop(),
                    seed = args.pop(),
                    array = args[0],
                    result = seed;
                
                if(args.length > 1){
                    array = args;
                }
                    
                for(var i = 0; i < array.length; i++){
                    result = callWith(fn, scope, [result, array[i]]);
                }
                
                return result;
            },
            "partial": function(scope, args){
                var outerArgs = args.all(),
                    fn = outerArgs.shift();
                
                return function(scope, args){
                    var innerArgs = args.all();
                    return callWith(fn, scope, outerArgs.concat(innerArgs));
                };
            },
            "flip": function(scope, args){
                var outerArgs = args.all().reverse(),
                    fn = outerArgs.pop();
                
                return function(scope, args){
                    return callWith(fn, scope, outerArgs)
                };
            },
            "compose": function(scope, args){
                var outerArgs = args.all().reverse();
                    
                return function(scope, args){
                    var result = callWith(outerArgs[0], scope, args.all());
                    
                    for(var i = 1; i < outerArgs.length; i++){
                        result = callWith(outerArgs[i], scope, [result]);
                    }
                    
                    return result;
                };
            },
            "apply": function(scope, args){
                var fn = args.next()
                    outerArgs = args.next();
                    
                return callWith(fn, scope, outerArgs);
            }
        };
        
    
    function scanForToken(converterList, expression){
        for (var tokenConverterKey in converterList) {
            var converter = converterList[tokenConverterKey],
                token = converter.tokenise(expression);
            if (token) {                
                return token;
            }
        }
    }

    function tokenise(expression, memoisedTokens) {
        if(!expression){
            return [];
        }
        
        if(memoisedTokens && memoisedTokens[expression]){
            return memoisedTokens[expression].slice();
        }
        
        var originalExpression = expression,
            tokens = [],
            totalCharsProcessed = 0,
            previousLength,
            reservedKeywordToken;
        
        do {
            previousLength = expression.length;
            
            var token;
            
            //Check for nests
            token = scanForToken(this.tokenConverters.nests, expression);
            
            if(!token){                
                //Check for primatives
                token = scanForToken(this.tokenConverters.primitives, expression);
            }
            
            if(!token){
                //Check for identifiers
                token = scanForToken(this.tokenConverters.identifiers, expression);
                if(token){
                    //Check for reserved keywords
                    token = scanForToken(this.reservedKeywords, token) || token;
                }
            }
            
            if(token){
                expression = expression.slice(token.length);
                totalCharsProcessed += token.length;                    
                tokens.push(token);
                continue;
            }
            
            if(expression.length === previousLength){
                throw errors.UnparseableToken + expression;
            }
            
        } while (expression);
        
        memoisedTokens && (memoisedTokens[originalExpression] = tokens.slice());
        
        return tokens;
    }

    function parse(tokens){
        for(var i = 0; i < tokens.length; i += (tokens[i].parse(tokens, i)||0) + 1){}
        return tokens;
    }
    
    function evaluate(tokens, scope){        
        scope = scope || new Scope();
        for(var i = 0; i < tokens.length; i++){
            var token = tokens[i];
            token.evaluate(scope);
        }
        
        return tokens;
    }
    
    global.Gel = function(){    
        var gel = {},
            memoisedTokens = {},
            memoisedExpressions = {};


        var stats = {};

        gel.printTopExpressions = function(){
            var allStats = [];
            for(var key in stats){
                allStats.push({
                    expression: key,
                    time: stats[key].time,
                    calls: stats[key].calls,
                    averageTime: stats[key].averageTime
                });
            }

            allStats.sort(function(stat1, stat2){
                return stat2.time - stat1.time;
            }).slice(-10).forEach(function(stat){
                console.log([
                    "Expression: ",
                    stat.expression,
                    '\n',
                    'Average evaluation time: ',
                    stat.averageTime,
                    '\n',
                    'Total time: ',
                    stat.time,
                    '\n',
                    'Call count: ',                    stat.calls
                ].join(''));
            });
        }

        function addStat(stat){
            var expStats = stats[stat.expression] = stats[stat.expression] || {time:0, calls:0};

            expStats.time += stat.time;
            expStats.calls++;
            expStats.averageTime = expStats.time / expStats.calls;
        }
            
        gel.Token = Token;
        gel.createNestingParser = createNestingParser;
        gel.parse = parse;
        gel.tokenise = function(expression){
            return tokenise.call(this, expression, memoisedTokens);
        };
        gel.evaluate = function(expression, injectedScope, returnAsTokens){
            var gelInstance = this,
                memoiseKey = expression,
                expressionTree,
                evaluatedTokens,
                lastToken,
                scope = new Scope();

            scope.add(this.functions).add(injectedScope);

            if(memoisedExpressions[memoiseKey]){
                expressionTree = memoisedExpressions[memoiseKey].slice();
            } else{            
                expressionTree = gelInstance.parse(gelInstance.tokenise(expression, memoisedTokens));
                
                memoisedExpressions[memoiseKey] = expressionTree;
            }
            
            var startTime = new Date();
            evaluatedTokens = evaluate(expressionTree , scope);
            addStat({
                expression: expression,
                time: new Date() - startTime
            });
            
            if(returnAsTokens){
                return evaluatedTokens.slice();
            }
                
            lastToken = evaluatedTokens.slice(-1).pop();
            
            return lastToken && lastToken.result;
        };
        gel.tokenConverters = {
            nests:{
                __proto__: tokenConverters.nests
            },
            primitives:{
                __proto__: tokenConverters.primitives
            },
            identifiers:{
                __proto__: tokenConverters.identifiers
            }
        };
        gel.reservedKeywords = {__proto__:reservedKeywords};
        gel.functions = {__proto__:functions};
        
        gel.callWith = callWith;
        return gel;
    };
    
})(this);