pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/switcher.circom";


template CheckRoot(n) { // compute the root of a MerkleTree of n Levels 
    signal input leaves[2**n];
    signal output root;

    //[assignment] insert your code here to calculate the Merkle root from 2^n leaves
    signal inter[2**n][n]; // for every level, we'll have an array of the hashes to be hashed
    component hasher[(2**n)/2][n]; // for every level, this will be the computed hashes of the hashes stored in inter

    for(var i = 0; i < 2**n; i++){
        inter[i][0] <== leaves[i]; // stores the leaf nodes in the array of the first level
    }

    for(var i = 1; i<=n; i++){ // the loop will hash the node pair in every level
        for(var j = 0; j < (2**n)/2; j++){
            hasher[j][i-1].inputs[0] <== inter[2*j][i-1];
            hasher[j][i-1].inputs[1] <== inter[2*j + 1][i-1];
            if(i == n){
                root <== hasher[0][i-1].out; // this will assert the hash at the last level as the root hash
            }
            else{
                inter[j][i] <== hasher[j][i-1].out; // else it will continue hashing
            }
        }
    }

    
}

template MerkleTreeInclusionProof(n) {
    signal input leaf;
    signal input path_elements[n];
    signal input path_index[n]; // path index are 0's and 1's indicating whether the current element is on the left or right
    signal output root; // note that this is an OUTPUT signal

    //[assignment] insert your code here to compute the root from a leaf and elements along the path
    component hasher[n]; // hashes at every level
    component l_r[n]; 
    var hash = leaf;

    for(var i = 0; i < n; i++){
        l_r[i] = Switcher(); // switches at every level depending on the path_index
        l_r[i].sel <== path_index[i];
        l_r[i].L <== hash;
        l_r[i].R <== path_elements[i];

        hasher[i] = Poseidon(2);
        hasher[i].inputs[0] <== l_r[i].outL;
        hasher[i].inputs[1] <== l_r[i].outR;

        hash = hasher[i].out; // updates the hash for every level
    }   

    root <== hash; // the final hash will be the merkle root

}
