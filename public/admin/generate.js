(function (exports) {
    'use strict';
    function incrementChar(char) {
        let nan = isNaN(char);
        let looped = false;
        if (nan){
            char = char.charCodeAt(0);
            char++;
            if (char > 122) {
                looped = true;
                char = 97;
            }
            return [String.fromCharCode(char), looped];
        } else {
            char = parseInt(char);
            char++;
            if( char > 9) {
                char = 0;
                looped = true;
            }
            return [String(char), looped];
        }
    }


    function generate(prefix, code, count) {
        code = code.split('');
        count = parseInt(count);
        let i = 0;
        let changingIndex = code.length - 1;

        function increment(){
            if (changingIndex < 0) {
                throw new Error(`Keyspace exhausted! Produced ${i + 1} keys, missing ${count - (i + 1)}`);
            }
            let result = incrementChar(code[changingIndex]);
            code[changingIndex] = result[0];
            if (result[1]) {
                changingIndex--;
                increment()
                changingIndex++;
            }
        }

        const results = [];
        while (i < count) {
            results.push(prefix + code.join(''));
            try{
                increment();
            } catch(e) {
                /* todo display keyspace error */
                break;
            }
            i++;
        }
        return results;

    }

    exports.generate = generate;
})(window);
