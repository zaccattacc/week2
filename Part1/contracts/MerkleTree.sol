//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { PoseidonT3 } from "./Poseidon.sol"; //an existing library to perform Poseidon hash on solidity
import "./verifier.sol"; //inherits with the MerkleTreeInclusionProof verifier contract

contract MerkleTree is Verifier {
    uint256[] public hashes; // the Merkle tree in flattened array form
    uint256 public index = 0; // the current index of the first unfilled leaf
    uint256 public root; // the current Merkle root

    using PoseidonT3 for uint256[2];

    constructor() {
        // [assignment] initialize a Merkle tree of 8 with blank leaves
        hashes = [0, 0, 0, 0, 0, 0, 0, 0];
        uint x = 8;
        uint y = 8;
         // For loop for every level
        for(uint i = 0; i < 3; i++ ){
            // for loop for the hashing
            for(uint j = 0; j < 2**(2-i); j++){

                uint256[2] memory toBeHashed = [hashes[x-y], hashes[x-y+1]];
            
                hashes.push(toBeHashed.poseidon());
                x++;
                y--;
            }
        }
        root = hashes[x-1];

    }

    function insertLeaf(uint256 hashedLeaf) public returns (uint256) {
        // [assignment] insert a hashed leaf into the Merkle tree
        hashes[index] = hashedLeaf;
        uint x = 8;
        uint y = 8;

        // For loop for every level
        for(uint i = 0; i < 3; i++ ){
            // for loop for the hashing
            for(uint j = 0; j < 2**(2-i); j++){
                
                uint256[2] memory toBeHashed = [hashes[x-y], hashes[x-y+1]];
                hashes[x] = toBeHashed.poseidon();
                x++;
                y--;
            }
            
        }
        index++;
        root = hashes[x-1];
        return root;

    }

    function verify(
            uint[2] memory a,
            uint[2][2] memory b,
            uint[2] memory c,
            uint[1] memory input
        ) public view returns (bool) {

        // [assignment] verify an inclusion proof and check that the proof root matches current root
        return verifyProof(a, b, c, input);
    }
}
